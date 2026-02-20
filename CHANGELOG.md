# Changelog

All notable user-facing changes to this bot are documented here.

## [Unreleased]

### Added
- New command-based leveling system (XP is gained from successful command activity, not message count).
- New leveling display in `profile` with level, XP progress, and progress bar.
- New gambling commands:
  - `coinflip <heads|tails> <bet>`
  - `dice <1-6> <bet>`
- New `work` command with job progression, job applications, and job-specific cooldowns.
- New `shop` command:
  - `shop [page]`
  - `shop buy <item_name> [quantity]`
- New `bank` command:
  - `bank`
  - `bank deposit <amount|all>`
  - `bank withdraw <amount|all>`
- Expanded item catalog with new usable consumables:
  - `snack_pack`
  - `coffee_thermos`
  - `scratch_ticket`
  - `payday_box`
  - `vault_key`
  - `bank_note`

### Changed
- `blackjack` updates:
  - Added surrender option for bets below `10,000 cm`.
  - Surrender is only available before the first action.
  - Surrender refunds `50%` of bet (floored).
  - Bets `>= 10,000 cm` now use High Table mode with distinct appearance.
  - Dealer now hits on soft 17 on High Table.
  - Blackjack now uses a persistent per-player 6-deck shoe (`312` cards total).
  - Shoe state is shown in footer as `Shoe: current/312`.
  - Shoe shuffle now uses CSPRNG for stronger randomness.
  - Shoe persistence was optimized to reduce DB writes during active hands.
  - Dealer opening blackjack now refunds the full bet (push).
- `work` updates:
  - Job changes require both entry fee and 20 completed works.
  - 20-work requirement also applies to the first job change.
  - Successful job change resets work cooldown and progress.
  - Denied applications still consume fee but keep current job and work progress.
- `profile` embed was cleaned up into clearer grouped sections.
- Wallet and bank balances are now separated:
  - Banked money is protected from `rob`.
  - Default max bank storage starts at `100`.
  - `bank_note` upgrades max bank storage based on current max capacity and level.
- Level scaling changed from linear to exponential growth.
- Invalid command usage no longer consumes command cooldown.
- Command cooldowns were rebalanced to be less restrictive:
  - Lower default/economy/stats cooldowns for better responsiveness.
  - External API command cooldowns are handled by a dedicated cooldown tier.

### Security
- Gambling commands were hardened against interruption/exploit scenarios:
  - Bets are deducted up front in interactive games.
  - Outcomes are settled explicitly as win/loss records.
  - Refund paths were added for interrupted sessions before settlement.
- Exclusive session behavior is enforced on gambling commands to prevent concurrent command abuse.

### Fixed
- `guildstats` now handles data type formatting safely and avoids crashes on mixed numeric/bigint values.
- Logging now preserves useful error details (`name`, `message`, `code`, `stack`) instead of blank error lines.
- PostgreSQL sleep/reconnect reliability improved for production:
  - Transient DB disconnects are detected and handled as reconnectable conditions.
  - Pool error handling was added/standardized across DB-backed services.
  - Extremely noisy DB error object logging was sanitized.
