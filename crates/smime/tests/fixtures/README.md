# S/MIME test fixtures

Made with OpenSSL 3 (test keys only, password `geheim`):

- `ca.pem` – self-signed test CA; `user.pem` – S/MIME certificate for
  `niklas@example.com` issued by it.
- `user-aes.p12` (PBES2/AES-256, OpenSSL 3 default), `user-3des.p12`
  (`-keypbe/-certpbe PBE-SHA1-3DES`, Windows style), `user-legacy.p12`
  (`-legacy`: RC2-40 certificates, 3DES key).
- `signed-openssl.eml` (`openssl smime -sign`, detached),
  `opaque-openssl.eml` (`-nodetach`), `encrypted-openssl.eml`
  (`smime -encrypt -aes256`), `encrypted-3des.eml` (`-des3`),
  `encrypted-oaep.eml` (`cms -encrypt -keyopt rsa_padding_mode:oaep -aes128`).
