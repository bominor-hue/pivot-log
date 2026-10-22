"""Rijndael with a 32-byte block, the cipher the AgSense (WagNet) API uses for its sign-in token.

AES is Rijndael fixed at a 16-byte block. AgSense's sample code (PHP mcrypt RIJNDAEL_256, C#
RijndaelManaged BlockSize 256) uses a 32-byte block, which no standard Python crypto library offers,
so this is a small plain implementation: CBC mode, zero padding, encrypt and decrypt.
block=16 gives plain AES, which the tests use to check it against a known library.
"""


def _xt(a):
    a <<= 1
    return (a ^ 0x11B) & 0xFF if a & 0x100 else a


def _mul(a, b):
    r = 0
    while b:
        if b & 1:
            r ^= a
        a, b = _xt(a), b >> 1
    return r


def _sbox():
    s = [0] * 256
    for x in range(256):
        inv = next((y for y in range(1, 256) if _mul(x, y) == 1), 0) if x else 0
        b, v = inv, inv
        for _ in range(4):
            b = ((b << 1) | (b >> 7)) & 0xFF
            v ^= b
        s[x] = v ^ 0x63
    return s


SBOX = _sbox()
INV = [0] * 256
for _i, _v in enumerate(SBOX):
    INV[_v] = _i
SHIFTS = {4: (0, 1, 2, 3), 6: (0, 1, 2, 3), 8: (0, 1, 3, 4)}  # row shifts by block words


class Rijndael:
    def __init__(self, key: bytes, block: int = 32):
        assert len(key) in (16, 24, 32) and block in (16, 24, 32)
        self.nb, nk = block // 4, len(key) // 4
        self.nr = max(self.nb, nk) + 6
        w = [list(key[4 * i:4 * i + 4]) for i in range(nk)]
        rcon = 1
        while len(w) < self.nb * (self.nr + 1):
            t = list(w[-1])
            i = len(w)
            if i % nk == 0:
                t = [SBOX[b] for b in t[1:] + t[:1]]
                t[0] ^= rcon
                rcon = _xt(rcon)
            elif nk > 6 and i % nk == 4:
                t = [SBOX[b] for b in t]
            w.append([a ^ b for a, b in zip(w[i - nk], t)])
        self.rk = [sum(w[r * self.nb:(r + 1) * self.nb], []) for r in range(self.nr + 1)]

    # state is column-major: byte (row r, column c) at index 4c + r
    def _shift(self, s, inverse=False):
        nb, out = self.nb, [0] * len(s)
        for c in range(nb):
            for r in range(4):
                k = SHIFTS[nb][r]
                src = (c - k) % nb if inverse else (c + k) % nb
                out[4 * c + r] = s[4 * src + r]
        return out

    @staticmethod
    def _mix(s, m):
        out = []
        for c in range(0, len(s), 4):
            col = s[c:c + 4]
            out += [_mul(m[r][0], col[0]) ^ _mul(m[r][1], col[1]) ^ _mul(m[r][2], col[2]) ^ _mul(m[r][3], col[3]) for r in range(4)]
        return out

    M = [[2, 3, 1, 1], [1, 2, 3, 1], [1, 1, 2, 3], [3, 1, 1, 2]]
    MI = [[14, 11, 13, 9], [9, 14, 11, 13], [13, 9, 14, 11], [11, 13, 9, 14]]

    def encrypt_block(self, b: bytes) -> bytes:
        s = [x ^ k for x, k in zip(b, self.rk[0])]
        for r in range(1, self.nr + 1):
            s = self._shift([SBOX[x] for x in s])
            if r != self.nr:
                s = self._mix(s, self.M)
            s = [x ^ k for x, k in zip(s, self.rk[r])]
        return bytes(s)

    def decrypt_block(self, b: bytes) -> bytes:
        s = [x ^ k for x, k in zip(b, self.rk[self.nr])]
        for r in range(self.nr - 1, -1, -1):
            s = [INV[x] for x in self._shift(s, inverse=True)]
            s = [x ^ k for x, k in zip(s, self.rk[r])]
            if r:
                s = self._mix(s, self.MI)
        return bytes(s)


def cbc_encrypt(key: bytes, iv: bytes, data: bytes, block: int = 32) -> bytes:
    """CBC with zero padding, as mcrypt and RijndaelManaged(PaddingMode.Zeros) do."""
    c, prev, out = Rijndael(key, block), iv, b""
    if len(data) % block:
        data += b"\0" * (block - len(data) % block)
    for i in range(0, len(data), block):
        prev = c.encrypt_block(bytes(a ^ b for a, b in zip(data[i:i + block], prev)))
        out += prev
    return out


def cbc_decrypt(key: bytes, iv: bytes, data: bytes, block: int = 32) -> bytes:
    c, prev, out = Rijndael(key, block), iv, b""
    for i in range(0, len(data), block):
        chunk = data[i:i + block]
        out += bytes(a ^ b for a, b in zip(c.decrypt_block(chunk), prev))
        prev = chunk
    return out.rstrip(b"\0\4")
