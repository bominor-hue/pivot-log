"""python3 -m unittest discover jobs  (needs the cryptography package only for the AES cross-check)"""
import base64, datetime as dt, os, sys, unittest
sys.path.insert(0, os.path.dirname(__file__))
from rijndael import Rijndael, cbc_decrypt, cbc_encrypt
import nightly_agsense as ag


def rd(date, **kw):
    return {"date": date, "power": "ON", "direction": "FWD", "angle": "0", **kw}


class Cipher(unittest.TestCase):
    def test_aes_vector(self):  # FIPS-197 C.3: Rijndael at a 16-byte block is AES-256
        k, pt = bytes(range(32)), bytes.fromhex("00112233445566778899aabbccddeeff")
        self.assertEqual(Rijndael(k, 16).encrypt_block(pt).hex(), "8ea2b7ca516745bfeafc49904b496089")

    def test_256_block_round_trip(self):
        k, iv = os.urandom(32), os.urandom(32)
        msg = b"demo,0123456789abcdef0123456789abcdef,1761177600"
        ct = cbc_encrypt(k, iv, msg)
        self.assertEqual(len(ct) % 32, 0)
        self.assertEqual(cbc_decrypt(k, iv, ct), msg)

    def test_token_is_url_safe_and_decrypts(self):
        c = ag.AgSense("demo", "agsense", "x", "k" * 32, "i" * 32)
        t = c.token()
        self.assertNotIn("+", t); self.assertNotIn("/", t); self.assertNotIn("=", t)
        raw = base64.b64decode(t.replace("-", "+").replace("_", "/").replace("%3D", "="))
        user, md5, ts = cbc_decrypt(b"k" * 32, b"i" * 32, raw).decode().split(",")
        self.assertEqual((user, md5), ("demo", c.md5))
        self.assertLess(abs(int(ts) - __import__("time").time()), 5)


class Runs(unittest.TestCase):
    def test_water_on_off_makes_one_run(self):
        rs = [rd("07/01/2026 05:00:00", water="OFF", direction="IDLE"),
              rd("07/01/2026 06:00:00", water="ON", speed="40", angle="10"),
              rd("07/01/2026 12:00:00", water="ON", speed="40", depth="0.5"),
              rd("07/01/2026 18:00:00", water="OFF", angle="200")]
        [r] = ag.build_runs(85007, rs, False)
        self.assertEqual(r["start"], dt.datetime(2026, 7, 1, 10, tzinfo=dt.timezone.utc))  # 6 am EDT
        self.assertEqual(r["hours"], 12)
        self.assertEqual((r["direction"], r["pct"], r["start_deg"], r["stop_deg"]), ("forward", 40, 10, 200))
        self.assertIn("panel depth 0.50 in", r["note"])

    def test_zone_offset_wins(self):
        r = rd("04/25/2024 14:08:00", zone_offset=-6)
        self.assertEqual(ag.when(r), dt.datetime(2024, 4, 25, 20, 8, tzinfo=dt.timezone.utc))

    def test_open_and_partial_runs_wait(self):
        rs = [rd("07/01/2026 06:00:00", pump="ON"), rd("07/01/2026 08:00:00", pump="OFF"),
              rd("07/01/2026 09:00:00", pump="ON"), rd("07/01/2026 10:00:00", pump="ON")]
        self.assertEqual(ag.build_runs(1, rs, False), [])  # first was wet at window start, second still going

    def test_reads_dry_counts_moving(self):
        rs = [rd("07/01/2026 06:00:00", direction="IDLE", pressure="N/A"),
              rd("07/01/2026 07:00:00", direction="REV", pressure="N/A", dc="60"),
              rd("07/01/2026 09:00:00", direction="IDLE", pressure="N/A")]
        [r] = ag.build_runs(1, rs, True)
        self.assertEqual((r["hours"], r["direction"], r["pct"]), (2, "reverse", 60))
        self.assertIn("reads dry", r["note"])

    def test_field_commander_pressure(self):
        rs = [rd("07/01/2026 06:00:00", pressure="0"), rd("07/01/2026 07:00:00", pressure="30"),
              rd("07/01/2026 15:00:00", pressure="0")]
        [r] = ag.build_runs(1, rs, False)
        self.assertEqual(r["hours"], 8)
        self.assertIn("no reading for 8 h", r["note"])

    def test_entry_id_is_stable(self):
        rs = [rd("07/01/2026 05:00:00", water="OFF"), rd("07/01/2026 06:00:00", water="ON"), rd("07/01/2026 07:00:00", water="OFF")]
        a = ag.entry_row(ag.build_runs(5, rs, False)[0], "p1", "now")
        b = ag.entry_row(ag.build_runs(5, rs, False)[0], "p1", "later")
        self.assertEqual(a["id"], b["id"])
        self.assertEqual((a["how"], a["action"], a["hours"], a["stop_at"]), ("agsense", "run", None, "2026-07-01T11:00:00Z"))

    def test_match_and_units(self):
        resp = {"device0": {"type": "pivot", "name": "A&amp;B 5", "serial": "42077"},
                "device1": {"type": "pivot", "name": "Hodges 3", "serial": "50009"}}
        pivots = [{"id": "p1", "agsenseName": "A&B 5", "profile": {}},
                  {"id": "p2", "name": "Hodges 3", "profile": {"agsenseSerial": {"value": "50009"}}}]
        m = ag.match(ag.units(resp), pivots)
        self.assertEqual({k: v["id"] for k, v in m.items()}, {"42077": "p1", "50009": "p2"})

    def test_csv_week_blocks_double_count(self):
        rs = [rd("07/01/2026 05:00:00", water="OFF"), rd("07/01/2026 06:00:00", water="ON"), rd("07/01/2026 07:00:00", water="OFF")]
        run = ag.build_runs(5, rs, False)[0]
        self.assertTrue(ag.overlaps_week(run, [{"start_at": "2026-06-29T04:00:00+00:00", "stop_at": "2026-07-06T03:59:59+00:00"}]))
        self.assertFalse(ag.overlaps_week(run, [{"start_at": "2026-07-06T04:00:00+00:00", "stop_at": "2026-07-13T03:59:59+00:00"}]))


if __name__ == "__main__":
    unittest.main()
