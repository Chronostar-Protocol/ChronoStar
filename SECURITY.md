# Security Policy

## Supported Versions

Security fixes are applied to the latest version on the master branch. ChronoStar is under active development, so older commits and unreleased development snapshots are not supported security targets. 

## Reporting a Vulnerability

Please report suspected vulnerabilities privately through GitHub's security advisory reporting flow:

[Report a vulnerability privately](https://github.com/Chronostar-Protocol/ChronoStar/security/advisories/new)

Do not open a public issue or include exploit details in a pull request. Include the affected component, the relevant commit or deployment, reproduction steps, impact assessment, and any proof-of-concept that can be shared safely. Remove credentials, private keys, patient data, and other sensitive information before submitting.

The maintainers will acknowledge a report within 3 business days, provide an initial severity assessment within 7 business days, and keep the reporter informed while the issue is investigated. Timelines may change for complex reports, but we will communicate any delay.

## Disclosure

Maintainers will coordinate a fix, deployment, and release communication with the reporter. Please allow reasonable time for remediation before public disclosure. We will credit reporters who opt in, and we will not disclose a reporter's identity without permission.

## Scope

The security scope includes:

- The three Soroban contracts: ScheduleVault, RecurringStream, and DCA Policy.
- The keeper service, including its execution and retry logic.
- The backend API, its authentication, validation, storage, and event handling.
- The frontend, including wallet connection, transaction construction, and user-facing security controls.

Reports about third-party infrastructure, Stellar protocol behavior, or dependencies should explain how they create a security impact for ChronoStar. General feature requests, support questions, and non-security bugs should use the normal issue tracker.
