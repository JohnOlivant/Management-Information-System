# Management Information System: product description

Version 0.1, 2 November 2026. Owner: John Olivant.

This document says what the product is, who it is for, what it must do and in what order. It is the input to the development plan. It builds on the [systems briefing](research/systems-briefing.md) and the [market check](research/market-check.md).

## 1. The product in one paragraph

The MIS gives the owner of a small UK construction firm or small manufacturer a forward-looking view of their business: what work is coming (pipeline), what is secured (order book), what has been done but not billed (WIP), when cash will arrive, whether the team has the capacity to deliver, and what margin the jobs will really make. It builds that view by joining the firm's quotes, schedule and timesheets to its Xero ledger on one job number. It is sold and delivered through the firm's accountant (Rule29 first), who uses the same view to give monthly forward-looking advice instead of a backward-looking P&L review.

## 2. The problem

- Small builders fail on cash timing and underpricing far more than on lack of work. The FMB describes them as managing "by feel rather than forecast", and construction has the most UK insolvencies of any industry (see the market check).
- The data needed for a forecast already exists inside the firm, but it is split across quoting, the diary, timesheets and Xero, and often spreadsheets. Nobody joins it up.
- Light tools either run the jobs (Tradify, Simpro, Joblogic) or forecast from the ledger (Fathom, Float). Neither sees both. The tools that do both (Archdesk, Eque2) are heavy, priced by quote and built for firms with a quantity surveyor.
- The accountant only sees the past. Rule29's current finance command centre turns a pasted monthly P&L into KPIs and commentary, but it cannot see quotes, jobs or hours.

## 3. Who it is for

### Target customers

| Segment | Size | Priority | Notes |
| --- | --- | --- | --- |
| Small UK construction and building services firms (builders, groundworks, M&E, fit-out, specialist trades) | 5 to 50 staff, roughly £0.5m to £10m turnover | **Primary, release 1** | Site-based crews, staged payments, retentions, CIS. The existing apps are shaped for this. |
| Small UK job-shop manufacturers (fabrication, joinery, engineering to order) | 5 to 50 staff | **Second segment, later release** | Pain assumed, not yet evidenced. Need materials and production routing that no current app holds. |

Firms are Xero users. Sole traders and firms with an in-house quantity surveyor are out of the target.

### Users

| User | What they want from the MIS |
| --- | --- |
| **Owner or managing director** | "Will I have the cash and the people for the next three months, and which jobs are losing money?" Looks weekly, on phone or laptop. |
| **Office or contracts manager** | Keeps quotes, the schedule and timesheets up to date; chases the actions the MIS raises. |
| **Accountant / advisor (Rule29)** | Sees all their client firms in one place, prepares a monthly forward-looking review, signs off WIP for month and year end. |
| **Estimator, supervisor, site worker** | Use the operational apps (quoting, scheduler, timesheet). They feed the MIS but do not need to open it. |

## 4. Positioning

- **For** owners of 5 to 50 person construction firms who use Xero and an accountant,
- **who** cannot see cash, capacity and margin coming before it hits them,
- **the MIS is** a forward-finance view built from their own jobs,
- **that** joins quotes, schedule and hours to the ledger on one job number and is reviewed with their accountant every month.
- **Unlike** Archdesk or Eque2, it is light enough to run without a QS. **Unlike** Fathom or Float, it sees the work that has not reached the ledger yet. **Unlike** Tradify or Simpro, it forecasts.

## 5. Product structure

The MIS is one product made of an analytical core and three operational apps that already exist.

| Part | Role in the MIS | Existing repo | State today |
| --- | --- | --- | --- |
| **Forward Finance (new core)** | Joins all sources per job and produces the forward views, alerts and the advisor workspace | This repo | Not started |
| Quoting | Source of pipeline, accepted values, quoted cost and margin, payment stages, man-hours by role | `sands-quoting` | Built to phase 7 of 10; invoicing and job costing not built |
| Scheduler | Source of programme dates, planned hours, crew availability | `job-scheduler` | Sheets pilot live; production on `production/foundation` |
| Timesheet | Source of actual hours, expenses and subsistence per job | `timesheet-pilot` | Sheets pilot in use; production is a draft PR |
| Xero gateway | Single route to Xero for invoices raised, payments, supplier bills, P&L, bank balance | `xero-gateway` | Design only |
| Finance command centre | Existing backward-looking KPI and AI commentary reports | `ai-finance-intelligence-platform` | Sheets + Apps Script; to be fed by, then folded into, the core |

**Design rule: the forward view must not depend on firms using all three of our apps.** Each source sits behind a connector with a defined interface. Release 1 reads our own apps and Xero. Later releases add connectors for tools firms already use (for example Tradify, Simpro, Xero quotes, a spreadsheet import). This answers the main market risk, which is having to beat well-funded trades tools at operations before anyone sees the forward view.

## 6. Core concept: the job

Every figure in the MIS rolls up from a **job**, identified by the quote reference (for example `Q00012`), which is already the shared job number in quoting, the scheduler and the timesheet.

A job moves through these stages, and each stage feeds a different view:

| Stage | Source of the stage | Feeds |
| --- | --- | --- |
| Open quote (issued, not answered) | Quoting | Pipeline, weighted pipeline, capacity demand |
| Won (accepted, authorised) | Quoting | Order book, revenue and cash forecast |
| Scheduled / in progress | Scheduler, timesheet | WIP, capacity, margin forecast |
| Invoiced / paid | Xero | Order book burn-down, cash actuals, debtors |
| Complete | Scheduler, Xero | Final margin, win-rate and estimating accuracy history |

For each job the core holds: contract value (accepted plus approved variations), quoted cost and margin, payment stages with expected dates, retention and CIS terms, planned and actual hours by role, labour cost, other costs from expenses and supplier bills, invoiced and paid amounts, and the expected or actual start and end dates.

## 7. What the product must do

Priorities: **M** = must have in release 1, **S** = should have in release 2, **C** = could have later.

### 7.1 Forward views

| # | View | What the user sees | How it is worked out | Priority |
| --- | --- | --- | --- | --- |
| V1 | **Pipeline** | Open quote value by month issued, valid-until, job type, lead source and customer; quotes about to expire | Sum of latest proposal value of issued, unanswered quotes | M |
| V2 | **Weighted pipeline** | Pipeline multiplied by the chance of winning, placed in the month the work is expected to start | Win probability from the firm's own history for similar quotes (job type, lead source, customer, budget or firm), overridable per quote; expected start date per quote | M |
| V3 | **Order book** | Secured work not yet invoiced, by job and in total, and months of work in hand | Contract value less invoiced to date | M |
| V4 | **Revenue forecast by month** | 12-month rolling forecast: secured work plus weighted pipeline | Order book spread over scheduled dates or payment stages; weighted pipeline spread from expected start over typical duration | M |
| V5 | **Cash-in forecast** | Expected receipts by week for 13 weeks and by month for 12 months, with the lowest point flagged | Payment stages by expected date, less CIS deductions, plus retention releases, adjusted by each customer's actual payment days from Xero | M |
| V6 | **Capacity vs demand** | Crew hours available by week and role against hours booked and weighted pipeline hours; weeks over or under capacity | Contracted hours less leave and unavailability (scheduler) against scheduled hours plus pipeline man-hours by role (quoting) | M |
| V7 | **WIP value (hours-based)** | Work done but not yet invoiced, per job and in total | % complete by hours used against planned hours, times contract value, less invoiced to date | M |
| V8 | **WIP value (cost-based and valuation-based)** | WIP the accountant can sign off at month and year end | Cost-to-cost % complete, or interim valuations and applications for payment, with retentions; method chosen per firm with the accountant | S |
| V9 | **Margin forecast and jobs at risk** | Forecast final margin per job against quoted margin; jobs drifting below a threshold | Cost to date (labour at cost rates, expenses, supplier bills by job) plus estimated cost to complete | S |
| V10 | **Cash-out and net cash forecast** | Payroll, supplier bills, VAT, PAYE and CIS payments against cash in; projected bank balance | Xero bank balance, bills, payroll and tax calendar plus forecast job costs | S |
| V11 | **Scenarios** | "What if we win this quote / lose this job / hire two people?" | Toggle quotes, jobs and capacity changes and re-run V4 to V10 | C |

### 7.2 Alerts and actions

| # | Requirement | Priority |
| --- | --- | --- |
| A1 | Weekly email or in-app summary for the owner: cash low point, capacity gaps, expiring quotes, jobs at risk | M |
| A2 | Alerts when a job's hours used pass a share of planned hours (for example 80%) before the job is near done | M |
| A3 | Data-quality warnings that say what is missing and where to fix it (quote with no expected start, job with no payment stages, timesheet hours on an unknown job) | M |
| A4 | Overdue payment stage and overdue debtor alerts from Xero | S |
| A5 | Margin-drift alerts per job | S |

### 7.3 Advisor workspace (accountant)

| # | Requirement | Priority |
| --- | --- | --- |
| W1 | One login sees all client firms the advisor is linked to, with a portfolio list ranked by risk (cash low point, capacity, margin) | M |
| W2 | Monthly forward review pack per client: the forward views, changes since last month, and AI-drafted commentary the advisor edits before sharing; exported as PDF | M |
| W3 | Client invites the advisor, and can revoke access, from inside the product | M |
| W4 | Advisor sets the firm's WIP method, margin thresholds and forecast assumptions, with an audit trail | S |
| W5 | Month-end WIP schedule the advisor can sign off and post as a journal to Xero | S |
| W6 | White-labelling with the practice's name and logo | C |

### 7.4 Inputs the core needs that do not exist yet

These are the gaps found in the systems briefing. Each one becomes a work item in the development plan.

| # | Gap | Proposed fix | Needed for |
| --- | --- | --- | --- |
| G1 | Open quotes have no expected start date or win probability | Add both fields to quoting (estimator sets start; probability defaults from history and can be overridden) | V2, V4, V6 |
| G2 | Timesheet holds no pay or cost rates, and entries carry no role | Hold a cost rate per worker (or per role, with a worker-to-role link) in the core, with effective dates; restricted to owner and advisor | V8, V9 |
| G3 | Xero gateway has no read operations for invoices, payments, bills by tracking category, P&L or bank balance | Add finance-read operations to the gateway; tag bills to jobs with a Xero tracking category named by job number | V3, V5, V8 to V10 |
| G4 | Quoting does not yet invoice or record variations | Quoting phase 6 (invoicing) and variations, or read invoices from Xero by job reference | V3, V7 |
| G5 | Apps use different tenant keys (`client_id` vs `company_id`) and two integration styles | One tenant identity across apps; each app publishes a read-only, versioned job feed the core reads | All |
| G6 | Retention and CIS terms are not held per job and customer | Add retention %, retention release dates and customer CIS status to quoting or the core | V5, V8 |

## 8. Data and integration requirements

- **Read-only.** The core never writes to the operational apps. It reads a versioned feed from each source (for example a `finance.job_feed_v1` view or API per app) and stores its own snapshots.
- **One connector per source,** each mapping into the same job model. Release 1 connectors: quoting, scheduler, timesheet, Xero (via the gateway).
- **Snapshots.** Forecasts are stored as dated snapshots so "what we expected last month" can be compared with "what happened". This is also how forecast accuracy is measured.
- **Refresh.** Operational data at least hourly; Xero at least daily and on demand.
- **Job matching.** Xero invoices and bills match to jobs by the job number in the reference or tracking category; unmatched items are listed for the office manager to assign.
- **Standalone apps still work.** Each operational app must keep working on its own; the MIS is an extra layer.

## 9. Non-functional requirements

| Area | Requirement |
| --- | --- |
| Tenancy | Multi-tenant from day one: every record carries the firm's tenant id; advisors are linked to many tenants |
| Access | Roles: owner, office manager, advisor, read-only. Cost rates and margins visible only to owner and advisor |
| Security and privacy | UK GDPR; data held in the UK or EU; encryption in transit and at rest; Xero tokens only in the gateway; audit log of advisor actions |
| UK specifics | CIS deductions, retentions, VAT and PAYE timing, UK financial year, £ throughout |
| Usability | Owner views readable on a phone; first useful view inside one working day of connecting Xero and quoting |
| Performance | Any view loads in under 3 seconds for a firm with 500 live jobs |
| AI commentary | Drafted, never published without a human; numbers in commentary come from the computed views, not the model. Provider choice to be settled (current command centre uses OpenAI) |
| Stack | Node 24, TypeScript, PostgreSQL, matching the operational apps |

## 10. Releases

| Release | Goal | Scope | Depends on |
| --- | --- | --- | --- |
| **0. Foundations** | One place where all job data lands | Core service and database, tenant model, job model, connectors for quoting, scheduler and timesheet feeds, Xero gateway read operations (G3), G5 | Timesheet production build merged; gateway code started |
| **1. Forward view for construction (MVP)** | An owner and their Rule29 advisor can see the next 3 to 12 months | V1 to V7, A1 to A3, W1 to W3, G1, G6. Pilot with 3 to 5 Rule29 construction clients | Release 0 |
| **2. Margin and month-end** | The accountant can sign off WIP and margin from the MIS | V8 to V10, A4, A5, W4, W5, G2, G4. Retire the pasted P&L in the finance command centre by feeding it from the core | Release 1, cost rates agreed with pilot firms |
| **3. Reach and second segment** | Firms that do not use our apps, and small manufacturers | Connectors for Tradify, Simpro and spreadsheet import; scenarios (V11); manufacturing job model (materials, routing) after interviews; W6 | Release 2, manufacturer interviews |

## 11. How we will know it works

| Measure | Target for the release 1 pilot |
| --- | --- |
| Firms live with all four sources connected | 3 to 5 Rule29 clients within 3 months of release |
| Owner weekly use | At least 3 of 4 weeks per firm |
| Advisor monthly review delivered from the MIS | Every pilot client, every month |
| Cash-in forecast accuracy | Forecast receipts for the next 4 weeks within 15% of actual |
| Data quality | Under 5% of hours and invoices unmatched to a job |
| Willingness to pay | At least half of pilot firms (or Rule29 on their behalf) agree to a paid price at the end |

## 12. Commercial model (hypothesis to test)

- Sold through Rule29 as part of an advisory or outsourced-FD package, so the accountant may pay and bundle it.
- Working price hypothesis: a monthly fee per firm in the range of light trades tools and ledger forecasting tools (roughly £50 to £150 a month per firm), with the operational apps priced per user on top for firms that take them. **Not validated.** Test with 8 to 10 Rule29 clients before release 1 ends.

## 13. Out of scope

- Replacing Xero or any accounting, payroll or bank functions.
- Writing into the operational apps or into Xero, except the month-end WIP journal (W5).
- Stock control, MRP and production routing (until the manufacturing release is decided).
- Commercial-scale CVR for firms with a QS team.

## 14. Assumptions and open questions

| # | Question | Who answers | Needed by |
| --- | --- | --- | --- |
| Q1 | Which WIP method will Rule29 sign off for small builders: hours-based, cost-to-cost or valuation-based? | Rule29 accountants | Release 2 design |
| Q2 | Who pays: the firm or the accountant? At what price? | 8 to 10 Rule29 client interviews | End of release 1 |
| Q3 | Are cost rates held per worker or per role, and who may see them? | Pilot firms, Rule29 | Release 2 |
| Q4 | Do pilot firms tag bills to jobs in Xero today, or must the MIS help them start? | Pilot firms | Release 0 |
| Q5 | Is the manufacturer pain real enough to build for? | Manufacturer interviews | Before release 3 |
| Q6 | Does the finance command centre move off Google Sheets onto the core, or stay as a reporting front end? | John | Release 2 |
| Q7 | Which AI provider for commentary? | John | Release 1 |

## 15. Related documents

- [Systems briefing](research/systems-briefing.md): the five systems, how they connect and the gaps.
- [Market check](research/market-check.md): evidence of the problem, competitors and risks.
