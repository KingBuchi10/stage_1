# Insighta CLI

This package is the command-line interface for the Insighta Labs+ platform.

## Install

```bash
npm install -g .
```

## Commands

```bash
insighta login [api-base-url]
insighta whoami
insighta logout
insighta profiles list [filters]
insighta profiles search "young males from nigeria"
insighta profiles get <profile-id>
insighta profiles create <name>
insighta profiles delete <profile-id>
insighta profiles export [output.csv]
```

## Credentials

Successful login stores tokens and metadata at:

```text
~/.insighta/credentials.json
```

The CLI automatically refreshes access tokens when they are close to expiry.
