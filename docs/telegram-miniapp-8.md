# Telegram Mini App 8.0 Surface

Status: implemented as optional capability wrappers.

Linear: MIN-272, MIN-258

## Source Check

Telegram Bot API 8.0 added Mini App support for fullscreen mode, persistent device storage, secure local storage, and home-screen shortcuts.

Primary source:

- https://core.telegram.org/bots/api-changelog

## Repository Changes

- `apps/telegram-miniapp/src/telegram-capabilities.ts` wraps fullscreen, home-screen, DeviceStorage, and SecureStorage with feature detection.
- The Mini App stores only non-secret UI hints client-side:
  - last active tab in DeviceStorage;
  - workspace/user/session metadata in SecureStorage.
- The JWT remains in memory via `setAuthToken`; OAuth refresh tokens still belong behind server-side connectors and HELM-governed flows.
- The home dashboard exposes fullscreen and home-screen actions when Telegram reports support.

## Boundary Notes

Mini App storage is not a replacement for PostgreSQL, Drizzle, connector token storage, or HELM approvals. External actions still enter through gateway/orchestrator and are governed before execution.
