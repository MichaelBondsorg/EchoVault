# Create Pull Request

Create a well-formatted pull request for the current branch.

## Pre-PR Checklist

1. Ensure all changes are committed
2. Push the branch to origin
3. Run build to verify no errors: `npm run build`
4. Run available tests: `npx vitest run`

## PR Template

```markdown
## Summary

- Brief description of changes
- Why these changes were made
- Any breaking changes or migrations needed

## Changes

- [ ] List specific changes made
- [ ] Include affected components/services

## Testing

- [ ] Build passes locally
- [ ] Tests pass (if applicable)
- [ ] Manual testing completed for:
  - [ ] Affected feature
  - [ ] Related features

## Safety Review (if applicable)

- [ ] No changes to safety-critical code, OR
- [ ] Safety review completed via /review-safety

## Deployment Notes

- Any special deployment steps
- Environment variables or secrets needed
- Database migrations required
```

## Create PR Command

```bash
gh pr create --title "feat: description" --body "$(cat <<'EOF'
## Summary
...

## Test Plan
...
EOF
)"
```
