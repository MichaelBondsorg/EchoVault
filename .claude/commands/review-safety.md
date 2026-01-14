# Review Safety-Critical Code

This command reviews changes that might affect crisis detection or user safety.

## Safety-Critical Files

These files should be reviewed with extra care:

1. `src/services/safety/` - Crisis detection logic
2. `src/config/constants.js` - Safety keywords and thresholds
3. `src/services/analysis/` - Entry classification (affects crisis flagging)
4. `functions/index.js` - analyzeJournalEntry function

## Review Steps

1. Check for changes to safety keywords: `git diff src/config/constants.js`
2. Review crisis detection logic: `git diff src/services/safety/`
3. Check analysis changes: `git diff src/services/analysis/`
4. Verify no safety thresholds were lowered
5. Test with sample crisis-indicating text if possible

## Critical Rules

- NEVER remove safety keywords without explicit approval
- NEVER lower crisis detection sensitivity
- ALWAYS maintain multiple detection methods (keywords + AI analysis)
- ALWAYS err on the side of caution for user safety
