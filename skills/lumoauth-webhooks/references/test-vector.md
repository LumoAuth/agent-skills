# Test vector for LumoAuth webhook signatures

Use these values in a unit test of the verification function, in any language. The
signature was computed the way LumoAuth signs a delivery: HMAC-SHA256 over
`<t>.<id>.<raw body>` with the signing secret as a UTF-8 string, written as lower-case
hexadecimal.

| Input | Value |
|---|---|
| Signing secret | `example-signing-secret` |
| `X-LumoAuth-Signature` | `kid=v1,t=1762768800,id=5f2b8c1d9e3a4f607182a3b4c5d6e7f8,v1=53e3e9d03ceae92614ff9beb32441592f12c51605b15c996bb9175ec9254cce0` |
| Clock for the test (`now`) | `1762768810` |
| Raw body (one line, no trailing newline) | see below |

```json
{"event":"user.created","timestamp":"2026-11-10T10:00:00+00:00","tenant":"acme-corp","data":{"target_type":"user","target_id":"0192a3f4-0000-7000-8000-000000000000","target_name":"jane@example.com"}}
```

Expected: accepted, delivery ID `5f2b8c1d9e3a4f607182a3b4c5d6e7f8`, event `user.created`,
organization `acme-corp`. Expected rejections: another secret; one byte appended to the
body; `now` set to `1762769101` (301 seconds later); no header; an empty list of secrets.

The signed payload of the vector starts with `1762768800.5f2b8c1d9e3a4f607182a3b4c5d6e7f8.`
followed by the body bytes.

A second secret in the list must not change the result: with the secrets
`["new-secret", "example-signing-secret"]` the vector is accepted. This is the state of a
receiver during a secret rotation.
