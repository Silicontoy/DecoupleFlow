# Name lookup · 2026-10-01

**The product name already has a public-project collision.** [lyt0310603/DecoupleFlow](https://github.com/lyt0310603/DecoupleFlow) is an existing Python project for decoupled model training. It is unrelated to this Agent Skill editor. Keep this distinction visible while deciding whether to rename before launch.

| Name | Observed result | Meaning |
|---|---|---|
| Product/project `DecoupleFlow` | Existing public repository, HTTP 200 | Already in use by another software project |
| npm `decoupleflow` | [Registry lookup](https://registry.npmjs.org/decoupleflow) returned HTTP 404 | No public package found at the check time |
| GitHub account `DecoupleFlow` | [Account API](https://api.github.com/users/DecoupleFlow) returned HTTP 404 | No public account found |
| GitHub organization `DecoupleFlow` | [Organization API](https://api.github.com/orgs/DecoupleFlow) returned HTTP 404 | No public organization found |

GitHub usernames and organization names share the account namespace, so both were checked. A 404 is not a reservation or a guarantee of registrability: a name may be reserved, restricted, or unavailable for reasons the public API does not expose. This is an occupancy check, not trademark clearance.

The project and package names remain unchanged. Nothing was registered or published. Recheck immediately before choosing a public name:

```bash
node scripts/check-name-availability.mjs
```

[Raw, timestamped results](verification/name-availability.json).
