# Contributing to Zevr Guard

Thank you for your interest in contributing. This document explains how.

## Developer Certificate of Origin (DCO)

All contributions to Zevr Guard must be **signed off** under the [Developer Certificate of Origin](https://developercertificate.org/). This is a lightweight declaration that you have the right to submit the code under the project's license.

Concretely, every commit must end with a line like:

```
Signed-off-by: Your Name <your.email@example.com>
```

Git adds this automatically when you commit with `-s`:

```bash
git commit -s -m "fix: handle empty tracker set"
```

By signing off, you certify that:

> (a) The contribution was created in whole or in part by me and I have the right to submit it under the open source license indicated in the file; or
>
> (b) The contribution is based upon previous work that, to the best of my knowledge, is covered under an appropriate open source license and I have the right under that license to submit that work with modifications, whether created in whole or in part by me, under the same open source license (unless I am permitted to submit under a different license), as indicated in the file; or
>
> (c) The contribution was provided directly to me by some other person who certified (a), (b) or (c) and I have not modified it.
>
> (d) I understand and agree that this project and the contribution are public and that a record of the contribution (including all personal information I submit with it, including my sign-off) is maintained indefinitely and may be redistributed consistent with this project or the open source license(s) involved.

## Before you open a PR

1. **Open an issue first** for non-trivial changes to discuss the approach
2. **Match existing style** — we use Prettier defaults and TypeScript strict mode
3. **Run the type checker**: `npx tsc -b --noEmit`
4. **Run the build**: `npm run build`
5. **Keep PRs focused** — one logical change per PR, with a clear title and description

## Commit message style

```
{tag}: {short title}

- {bullet describing change}
- {bullet describing change}
```

Tags:

- `fix:` bug fixes
- `add:` new features or files
- `update:` enhancements to existing features
- `clean:` refactoring without behavioral change

## What we accept

- Bug fixes
- Performance improvements
- Additional tracker / malware data sources
- Accessibility and i18n improvements
- Documentation fixes

## What we generally won't merge

- Changes that weaken the privacy model (adding telemetry, analytics, or outbound traffic that includes user data)
- Features that require a paid SaaS backend (those live in a separate closed-source repository)
- Large architectural rewrites without prior discussion

## License

By contributing, you agree that your contribution will be licensed under [GPL-3.0-only](./LICENSE).
