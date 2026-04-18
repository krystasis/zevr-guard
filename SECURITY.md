# Security policy

## Reporting a vulnerability

If you believe you have found a security vulnerability in Zevr Guard, please **do not open a public GitHub issue**.

Instead, email the maintainer directly:

**security@zevrhq.com**

Please include:

- A description of the vulnerability and its impact
- Steps to reproduce, including browser version, extension version, and any relevant pages or domains
- Whether you intend to publish a disclosure, and if so, the intended timeline

## What to expect

- We will acknowledge the report within **72 hours**.
- We will provide an initial assessment and estimated fix timeline within **7 days**.
- Critical issues (remote code execution, privacy breach, bypass of blocking) will be addressed with a patch release as soon as a fix is verified.
- After the fix ships to Chrome Web Store, we will credit the reporter in the release notes unless anonymity is requested.

## Scope

In scope:

- The extension code in this repository
- The threat-DB feed endpoint (`https://zevrhq.com/feed/v1/*`)
- Any privacy claim stated in the README or landing page

Out of scope:

- Vulnerabilities in Chrome itself or in third-party threat-DB providers (report those upstream)
- Issues that require an attacker already having compromised the user's device
