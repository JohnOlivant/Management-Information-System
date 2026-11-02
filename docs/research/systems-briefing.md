# MIS integration briefing: the four systems and the forward view

2 November 2026 · John Olivant. Copied from the Claude Docs original.

## Summary

The three operational apps already share one job number and one stack, but the finance command centre only sees Xero's past P&L, so nothing forward-looking reaches it today.

- **Quoting** (`sands-quoting`) already holds most of the future: issued quotes waiting, won work with accepted value, and payment stages with expected dates. It has a pipeline report, but it stays inside quoting.
- **Scheduling** (`job-scheduler`) knows when work happens and planned labour hours per job, but holds no money.
- **Timesheet** (`timesheet-pilot`) knows actual hours and job expenses per job, but holds **no pay or cost rates**, so it cannot put a value on labour.
- **Finance command centre** (`ai-finance-intelligence-platform`) is a Google Sheet that turns a monthly Profit & Loss tab into KPIs and AI commentary (OpenAI). It has no job, quote or forecast data.
- **Xero gateway** (`xero-gateway`) is designed as the one door to Xero for all three apps, but has no code yet and no finance-reporting operations.

All repos were reachable. The forward view needs three things joined on the job number: quoted value and cost (quoting), timing and planned hours (scheduler), and hours and costs to date (timesheet). Labour cost rates are the main missing piece.

## The systems

Each operational app has a Google Sheets pilot and a production build on Node 24 + PostgreSQL 18, with one company ID on every table so the apps can be sold to many firms. The finance command centre is still Sheets only.

| System | What it does | Stack and status | Data that matters for the forward view |
| --- | --- | --- | --- |
| [Quoting](https://github.com/JohnOlivant/sands-quoting) | Estimates with packages, cost and sell per line, approvals, proposal PDF, online acceptance, payment stages, pipeline report, Field mode on the phone | Node 24, `pg`, TypeScript, React. Built through phase 7 of 10; Xero invoicing (phase 6) and job costing (phase 8) not built. Old WordPress prototype in `sands-quotation-system` is reference only | `estimates` (status draft, issued, accepted, declined, expired, authorised, withdrawn; kind budget or firm; lead source; job type), `revisions` (valid until, priced sheet as JSON with cost, overhead, margin and sell), `accepted_total`, `payment_stages` (percent + expected date), activities with man-hours by role |
| [Job scheduler](https://github.com/JohnOlivant/job-scheduler) | Rules-based crew scheduling (skills, certificates, availability, crew size), Gantt timeline, job tickets, planned vs used hours | Sheets pilot live; production app on `production/foundation` (Node 24, `pg`, schema `scheduling`), standalone or connected mode | `job_plans` (start, end, status, min crew, `planned_minutes`), `assignments` (worker, dates), unavailability, a Jobs to schedule inbox fed by quoting |
| [Timesheet](https://github.com/JohnOlivant/timesheet-pilot) | Worker time entry by job, supervisor and payroll approval, leave, subsistence, receipt-backed expenses, mileage, Xero payroll CSV | Sheets pilot in field use; production on `production/postgres-foundation` (draft PR #4) with migration 011 exposing an `integration` schema | `time_entries` (worker, job, date, hours, code, activity), `submissions` status (submitted, payroll approved, exported), `expense_lines` and `subsistence_claims` per job. **No pay or charge-out rates** |
| [Finance command centre](https://github.com/JohnOlivant/ai-finance-intelligence-platform) | KPI dashboard, KPI history charts, business health and quarterly management reports with AI commentary, PDF and Slides output | Google Sheets + Apps Script, OpenAI API. Last change 7 Aug 2026 | A monthly `Profit & Loss` tab (pasted, not linked to Xero) feeding a `KPI Engine` tab: turnover, gross and operating margin, cost of sales, admin costs, a crude cash-flow line (turnover less costs). All backward-looking |
| [Xero gateway](https://github.com/JohnOlivant/xero-gateway) | Planned single service for all Xero access: OAuth, tokens, rate limits, named operations | Design only, no code (scaffold merged 28 Oct 2026) | Planned: contacts, quotes, invoices from quotes, Xero Projects, payroll timesheets. No operations yet for P&L, aged debtors, bills or bank balance |

## How they connect today

The quote reference (for example `Q00012`) is the one job number in quoting, the scheduler and the timesheet, fixed when an approver authorises the job. That shared key is what makes a joined-up forward view possible.

_(Diagram in the original doc: how the five systems connect today, with two missing links: nothing reaches the finance command centre from the three apps, and Xero is not read back.)_

- **Quoting to scheduler** is agreed and built as [integration contract v1](https://github.com/JohnOlivant/sands-quoting/blob/main/docs/integration-contract.md) (26 Oct 2026): HTTP + JSON with an outbox each side. The handover carries man-hours, crew and roles but deliberately **no prices or costs**. The scheduler sends back the job number, programme dates, completion and cancellation.
- **Scheduler to timesheet**: jobs are written into the timesheet's job list; used hours come back by CSV import now, and live through `integration.job_hours_v1` (submitted, approved, exported) once connected mode is on.
- **Timesheet to Xero**: a payroll CSV export now; the Xero gateway is meant to take over.
- **Xero to finance**: the P&L is pasted into the Sheet each month. Nothing from quoting, the scheduler or the timesheet reaches the command centre.

## Forward-looking finance: what each view needs

Pipeline, cash-in timing and capacity can be built from data that already exists; true WIP and margin forecasts are blocked by missing labour cost rates and missing Xero reads.

| View | How it is worked out | Where the data is | Ready today? |
| --- | --- | --- | --- |
| Pipeline (open quotes) | Value of issued, unanswered quotes, by month issued, valid-until, job type and lead source | Quoting: `estimates`, latest proposal value, `valid_until` | **Yes.** Already in quoting's pipeline report, just not in finance |
| Weighted pipeline | Open value × win rate for similar quotes (job type, lead source, customer, budget or firm) | Quoting history of issued, accepted, declined and expired | **Partly.** History exists; no win-probability or expected-start field; conversion report is phase 9 |
| Order book (secured work) | Accepted value of authorised jobs not yet invoiced | Quoting `accepted_total`; invoiced amounts from Xero | **Partly.** Accepted value yes; invoiced-to-date needs quoting phase 6 or the Xero gateway |
| WIP value | Work done but not yet invoiced: % complete × contract value, less invoiced. % complete by cost-to-cost or by hours | Quoting revision cost and sell; timesheet hours and expenses; Xero bills and invoices; scheduler status | **Hours-based proxy only.** Planned vs used hours already exists in the scheduler. Cost-based WIP needs cost rates and bills |
| Revenue forecast by month | Order book spread over scheduled dates (or payment stages), plus weighted pipeline spread from an expected start | Scheduler `job_plans` start and end; quoting payment stages | **Partly.** Won work yes; open quotes have only free-text programme |
| Cash-in forecast | Payment stages by expected date, retention releases, less CIS deductions | Quoting `payment_stages`, customer CIS rate | **Yes for won work.** Payment status from Xero still missing |
| Capacity vs demand | Available crew hours by week (contracted hours less leave and bookings) against scheduled hours plus weighted pipeline man-hours by role | Scheduler workers, availability, assignments; quoting activity man-hours by role | **Mostly.** Role to skill mapping exists in the scheduler link |
| Margin forecast and jobs at risk | Quoted margin vs cost to date plus cost to complete | Quoting cost lines; timesheet; Xero bills | **No.** Needs labour cost rates and supplier bills |

## Gaps to settle before generating ideas

1. **Labour cost.** The timesheet holds hours but no pay or cost rates, and entries carry no role. Quoting's design (8.6) suggests costing hours at the rates list by role; that needs a worker-to-role link.
2. **Xero reads.** The gateway design has no operations for invoices raised, payments, supplier bills by tracking category, or the P&L. All are needed for WIP and to replace the hand-pasted P&L.
3. **Quote fields.** No expected start date or win probability on an open quote, so pipeline can't be placed in a forecast month or weighted without a model.
4. **Where the forward view lives.** The command centre is Google Sheets + OpenAI; the apps are Node + PostgreSQL. Options: a read-only finance module over each app's interface, or feeding the Sheet.
5. **Two integration styles.** Scheduler and timesheet share a database through `integration.*_v1` views; quoting and scheduler talk over HTTP with separate databases. A finance read needs one agreed approach, and company IDs differ per app (`client_id` vs `company_id`).
6. **WIP method.** Small construction firms often value WIP from interim valuations and applications for payment, with retentions; cost-to-cost or hours-based may suit others. Worth agreeing with an accountant per target segment.
7. **Manufacturers.** All three apps are shaped around site work (crews, sites, RAMS, tickets). Small manufacturers will also need materials, stock and production routing, which none of the systems hold.
8. **Maturity.** The timesheet's production build is a draft PR; quoting invoicing, variations and job costing are not built; the gateway has no code.
