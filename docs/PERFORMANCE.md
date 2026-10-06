# Admin agent performance

Open **Reports → Performance**, or **Agents → View team performance**. The month picker uses Asia/Manila business dates. Overview shows completed sales, deals, posted package commissions, targets reached, approved rewards, a top-five sales ranking, a daily sales graph with accessible daily figures, and the full team leaderboard.

## Sales and rankings

- A completed sale is delivered and fully paid, dated by `sale_completed_at`. Package selling prices and standalone line prices come from saved order terms. Standalone sales count toward performance and targets but earn no package commission.
- Rankings use completed sales descending, then completed deals descending, then agent ID ascending. Agents with zero sales remain in the leaderboard; inactive agents remain visible with an inactive label.
- Reports include live sales using the current sales rules. Imports and legacy orders are excluded because their financial completion date was not captured reliably. No historical date or commission is inferred or backfilled.
- Open orders were created in the selected month and still await approval, delivery, or full payment. Completed sales can come from orders created in earlier months.
- Commission totals use postings made in the selected month. Approved rewards are attributed to their target/bonus month, even if the approval was recorded later. These are separate figures and are never added to sales.

## Customer ratings and reviews

Customers open **My orders → Details and follow-up** in the portal to submit one 1–5 rating and a written review after delivery and full payment. Submitted reviews cannot be edited; retrying an identical submission safely returns the saved review. Customers can only see and review their own orders.

The team leaderboard shows each agent's average rating and review count. **Customer feedback** shows comments, rating, customer, submission time and an order link, with filters for individual agents or office orders. The reporting month uses the review's submission date in Asia/Manila, including feedback about older purchases. Feedback stays credited to the agent on the order even when the customer is reassigned. Office orders have no agent and are excluded from agent averages. Ratings describe the purchase and service experience and do not change sales rankings, targets, commissions or awards. Agents without reviews display **No reviews**.

## Monthly targets and incentives

Set one peso sales target per agent per month, with an optional fixed peso incentive. Use zero for a target without a financial reward. Target progress can exceed 100%; the progress bar stops at 100%.

An incentive becomes **Ready to approve** when completed sales reach the target. Admin approval rechecks current qualifying sales and records the saved fixed amount once. Concurrent approvals, repeat clicks, and retries reuse that target's reward. Target and incentive terms become locked after approval. Goals remain editable before approval; no existing goals or rewards are generated automatically.

## Admin-approved bonuses

Choose an agent, enter a positive peso amount and a reason, and select **Approve and record bonus**. The immutable record saves the agent, business month, amount, reason, approving admin, and UTC recording time. Retry the same submission after a temporary failure; its submission key prevents a second award. A reused key with different details is rejected.

Rewards are approved award records, separate from package commissions. Payment, payroll, refunds, and reward reversals are not implemented here.

## Deployment and verification

**Print / Save PDF** prints the selected performance view (Overview, Targets & incentives, Bonuses & history, or Customer feedback) with the loaded month/timezone, load time and summary. Editing controls and notifications are hidden; daily figures expand for printing and restore afterward. Printing Customer feedback uses the current agent filter. **Export CSV** always includes the whole loaded month's summary, agents/targets with rating averages/counts, daily sales, approved rewards and all reviews, across all views. The UTF-8 download is `tnl-performance-YYYY-MM.csv`, with `section`, period, timezone, currency and load-time columns. Amounts are raw PHP values; rewards remain awards, not payouts. See [report output conventions](REPORTS.md#print-and-csv).

Run `npm run db:migrate` from `backend` before starting the updated API. It creates `agent_targets`, `agent_rewards` and `order_reviews` without creating goals, awards, reviews or commission postings. Team performance, customer feedback and reward management are admin-only. Agents can read their own monthly rewards from the **Incentives & bonuses** panel on their dashboard. The same panel appears on the admin agent detail page, with a link to reward management.

The panel shows approved incentive/bonus totals, the monthly sales incentive and its approval status, target progress, and approved rewards with reasons, approver, and dates. Its month picker supports reward history. Target eligibility does not add an unapproved incentive to approved totals. Reward approval does not confirm payout.

Backend integration tests use a disposable MySQL schema and cover mixed package/product totals, completion/date boundaries, month validation, zero-sales agents, access denial, persisted targets, eligibility rechecking, concurrent incentive approval, locked terms, bonus replay, and commission separation. Run from `backend`: `TNL_INTEGRATION=1 npm test` (set the variable using the syntax for your shell).

With the frontend running and Playwright/Chrome available, run `node frontend/scripts/check-performance.cjs`. `LAYOUT_URL` and `LAYOUT_OUTPUT` can override the development URL and screenshot directory. The script mocks all business APIs and covers navigation, charts and daily values, targets, incentives, bonus history/retry, empty months, and 320/390px layouts. It makes no database writes.

Manual acceptance:

With the frontend running and Playwright/Chrome available, run `node frontend/scripts/check-reviews.cjs` for customer eligibility, required inputs, retry and persistence, escaped comments, agent averages, feedback filters, CSV and print at desktop and 320/390px widths. All API calls use fixtures. Override the URL with `LAYOUT_URL` and optionally save screenshots with `LAYOUT_SCREENSHOT_DIR`. Backend review acceptance is included in `seed-integration.test.ts` and checks ownership, validation, workflow eligibility, concurrent submissions and agent attribution in a disposable schema.

1. Open Performance as an admin. Choose a month and compare completed sales with saved order totals; delivered unpaid orders must not count.
2. Open daily figures and verify the date of a sale completed around midnight in Manila. Follow an agent link to their detail page.
3. Set a monthly target with and without an incentive. Reload and verify the values persist. Incomplete targets must have no approval button.
4. Approve a qualified incentive. It must appear once in history and prevent edits to that target's terms. Package commission postings must remain unchanged.
5. Add a bonus with a meaningful reason. Verify the amount, admin, recording time, and month in history; the reward must remain separate from sales and commissions.
6. Verify an Agent or Customer cannot access the team performance route or reward management APIs. Agents can read their own reward panel, but attempts to read another agent's rewards fail. Customers cannot read rewards.
7. Check the panel on the agent dashboard and admin agent detail page. Change months; verify totals, target progress, approval status, reward reasons/dates, empty months, and retry feedback. Run `node frontend/scripts/check-agent-rewards.cjs` for fixture checks at desktop and phone widths in light and dark themes.
8. Submit a review from a customer's completed, fully paid order. Reload to see the saved review. Unfinished orders must have no review form. In Performance, choose the submission month and check the agent average/count, Customer feedback filters and order links. Reassigning a customer must not move their review to another agent.
