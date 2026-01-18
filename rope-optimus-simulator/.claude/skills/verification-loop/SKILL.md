# Verification Loop Skill

A skill to manage the test failure → fix → retest loop.

## When to Use

- When `npm run dev` produces errors
- When components don't display correctly
- When animations don't work

## Loop Flow

```
1. Check error message
2. Identify cause (console, devtools)
3. Apply minimal fix
4. Run again to verify
5. Stop and report after 3 failures
```

## Report Format (After 3 Failures)

```
## Verification Failed

- **Error**: Error message
- **Attempts**: Fixes attempted
- **Hypothesis**: Theory on the cause
- **Request**: Request for human assistance
```

## Checkpoints

- [ ] Did you read the error message accurately?
- [ ] Is the change minimal?
- [ ] Did you consider side effects?
