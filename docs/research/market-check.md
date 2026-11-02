# Forward-looking finance for small firms: market check

2 November 2026 · John Olivant. Copied from the Claude Docs original.

## Verdict

**Yes, the problem is worth solving, and no one has solved it for this exact buyer.** Construction leads UK insolvencies, and the usual cause is cash timing rather than lack of work. Builders manage "by feel rather than forecast", and most firms still run on spreadsheets.

The pieces exist, but they are split across three groups of products:

- **Construction cost-control and ERP** (Archdesk, Eque2, Planyard): these do WIP, cost value reconciliation (CVR) and cost-to-complete. They are priced by quote and built for firms with a quantity surveyor.
- **Trades job management** (Tradify, Simpro, Joblogic, BigChange): these cover quote to schedule to invoice for £25 to £80 a user a month. None of them sells WIP or forecasting.
- **Accountant forecasting tools** (Fathom, Float, Spotlight): these forecast from the Xero ledger only. They cannot see quotes, the schedule or hours.

The open gap is a forward view that joins quote, schedule and hours to the ledger. It would be priced for 5 to 50 staff and sold through the firm's accountant. Rule29 is an accountancy firm selling diagnostics, cash-flow advice and an outsourced finance department, so this is its natural channel.

The biggest risk is the effort of rebuilding the operational apps that Tradify and Simpro already sell.

## Is the problem real?

Yes. The evidence points at poor forward visibility and disconnected systems rather than lack of work.

| Finding | Figure | Source |
| --- | --- | --- |
| Construction insolvencies, 12 months to April 2025 | 4,032, which is 17% of all UK cases and the highest of any industry | [FMB, May 2026](https://www.fmb.org.uk/resource/why-builders-run-into-cashflow-trouble-and-how-to-avoid-it.html) (Insolvency Service data) |
| Why builders fail | Cash timing, underpricing and "managing by feel rather than forecast". FMB recommends a 12-month rolling forecast by job, updated weekly | [FMB, May 2026](https://www.fmb.org.uk/resource/why-builders-run-into-cashflow-trouble-and-how-to-avoid-it.html) |
| Construction and property firms in or near serious financial distress | 86%; 93% hit by late payment, average 53 days overdue | [Menzies via Credit Connect, June 2026](https://www.credit-connect.co.uk/news/86-of-construction-firms-facing-serious-financial-distress/) |
| SME builders with lower-than-expected profits or losses | 51%, while workloads rose 22% | [CIOB and FMB State of Trade, H2 2025](https://www.designingbuildings.co.uk/wiki/Construction%20SMEs%20face%20mounting%20cost%20pressures%20and%20insolvencies%20despite%20continuous%20growth,%20report%20warns) |
| Construction firms still using manual spreadsheets | 94%; no respondent had fully integrated software; staff spend 48% of their time moving data between tools | [Causeway survey, 2023](https://www.theconstructionindex.co.uk/news/view/constructions-digital-progress-proving-slower-than-bosses-believe) (a vendor survey of 175 people) |
| UK construction SMEs | About 885,000, which is 16% of all SMEs, most of them sole traders | [Business population estimates 2025](https://www.gov.uk/government/statistics/business-population-estimates-2025/business-population-estimates-for-the-uk-and-regions-2025-statistical-release) |

I found no comparable UK evidence for small manufacturers, so their pain is assumed rather than shown.

## Who already solves it

The closest all-in-one competitor is Archdesk, which has quoting, scheduling, timesheets, WIP and Xero, but it is a 30-module system. No one targets small firms through their accountant. Prices are as published in comparison articles from July to October 2026; check them before quoting.

| Product | Group | Price (UK unless noted) | Forward finance | Gap for our buyer |
| --- | --- | --- | --- | --- |
| [Archdesk](https://archdesk.com/en-gb/solutions/work-in-progress-reporting) | Construction ERP | Quote only | WIP from cost against forecast final cost, over- and under-billing, CVR, cashflow | Heavy: 30+ modules, aimed at commercial teams |
| [Eque2](https://planyard.com/blog/7-best-construction-cost-control-software-for-small-contractors) | Construction ERP on Sage | Quote only | WIP dashboard, forecasts | Sage-based, no scheduling or timesheets |
| [Planyard](https://planyard.com/en-gb/best-construction-job-costing-software) | Construction cost control | £40 to £164 per project manager | Forecast to complete, CVR, Xero | No scheduling, payroll or CIS |
| Tradify, Joblogic, BigChange, ServiceM8, Simpro | Trades job management | £25 to £80 a month, or per user ([Whito](https://whito.co.uk/trades/tools/job-management-software-uk-trades-cost/), [Joblogic](https://www.joblogic.com/blog/best-job-costing-software-for-field-service-uk-2026)) | None stated | Do the operations; no WIP or forecast |
| [Xero](https://www.xero.com/uk/small-businesses/construction/job-costing-software/) | Ledger | £70 a month for Projects (Ultimate) | 30 to 180 day cash forecast from invoices and bills | No pipeline, schedule or WIP. Xero retired WorkflowMax in 2024 |
| [Fathom](https://bookkeepertools.uk/fathom-review-2026-xero-reporting-uk-bookkeepers/), Float, Spotlight | Accountant forecasting | Fathom about £29 to £59 a month | Ledger-based and driver-based forecasts, sold to accountants | Can't see quotes, jobs or hours |
| [MRPeasy, Katana](https://www.smartmanufacture.co.uk/mrpeasy-vs-katana-which-mrp-system-suits-a-uk-manufacturer/) | Manufacturing MRP | MRPeasy from $49 a user; Katana from $359 a month | Sales forecasting (MRPeasy) | Planning and stock; no quoting, job costing or WIP |
| [DynamxMFG, Fulcrum](https://totalcontrolpro.com/blog/best-manufacturing-job-tracking-software-affordable-small-business/) | Job-shop manufacturing | Quote only | WIP and job costing (DynamxMFG) | Shop-floor tools; no forward cash or pipeline view |

## Where the gap is

The products that join job data to a forward view are heavy systems priced by quote. The light, cheap ones either run the jobs or forecast from the ledger, but none does both.

_(Chart in the original doc: competitors placed by how light the product is against how far it joins job data to a forward view. Positions are approximate.)_

The target spot is a forward view built from quotes, the schedule and hours. It would be light enough for a 5 to 50 person firm and delivered as part of the accountant's advisory service. Positions are my judgement from published feature lists, not tests.

## Risks and what to validate next

The main risk is effort: competing on quoting, scheduling and timesheets puts you against well-funded trades tools at £25 to £80 a user. The forward view is where you would be different.

- **Wedge choice.** One option is to build the forward view so it can also read from tools firms already use (Tradify, Simpro, Xero quotes), and offer your own apps to firms with none. That widens the market and cuts the build risk.
- **Willingness to pay.** No evidence yet on what a 5 to 50 person firm would pay, or whether the accountant or the client pays. Ask 8 to 10 Rule29 clients in construction and manufacturing.
- **WIP method.** Small builders may value WIP from interim valuations rather than cost-to-cost. Check with Rule29's accountants what they would sign off.
- **Manufacturers.** I found no UK evidence of their forecasting pain, and their tools centre on stock and production. Treat them as a second segment until interviews say otherwise.
- **Source quality.** Several comparisons are written by vendors (Planyard, Joblogic, TotalControlPro), and the spreadsheet figure is a 2023 vendor survey. Absence of a feature in an article is not proof the product lacks it.

## Sources

All opened 2 November 2026.

- [Rule 29 home page](https://www.rule29.co.uk)
- [FMB: Why builders run into cashflow trouble](https://www.fmb.org.uk/resource/why-builders-run-into-cashflow-trouble-and-how-to-avoid-it.html)
- [Credit Connect: 86% of construction firms facing serious financial distress](https://www.credit-connect.co.uk/news/86-of-construction-firms-facing-serious-financial-distress/)
- [Designing Buildings: CIOB and FMB State of Trade](https://www.designingbuildings.co.uk/wiki/Construction%20SMEs%20face%20mounting%20cost%20pressures%20and%20insolvencies%20despite%20continuous%20growth,%20report%20warns)
- [Construction Index: Causeway digital survey](https://www.theconstructionindex.co.uk/news/view/constructions-digital-progress-proving-slower-than-bosses-believe)
- [Business population estimates 2025](https://www.gov.uk/government/statistics/business-population-estimates-2025/business-population-estimates-for-the-uk-and-regions-2025-statistical-release)
- [Planyard: best construction job costing software](https://planyard.com/en-gb/best-construction-job-costing-software)
- [Planyard: cost control software for small contractors](https://planyard.com/blog/7-best-construction-cost-control-software-for-small-contractors)
- [Archdesk: WIP reporting](https://archdesk.com/en-gb/solutions/work-in-progress-reporting) and [UK overview](https://archdesk.com/construction-management-software-uk)
- [Xero: construction job costing](https://www.xero.com/uk/small-businesses/construction/job-costing-software/)
- [Xero to retire WorkflowMax](https://devblog.xero.com/xero-to-retire-workflowmax-mid-2024-6f12f45e4be)
- [Whito: job management software cost for UK trades](https://whito.co.uk/trades/tools/job-management-software-uk-trades-cost/)
- [Joblogic: job costing software for field service](https://www.joblogic.com/blog/best-job-costing-software-for-field-service-uk-2026)
- [Bookkeeper Tools: Fathom review](https://bookkeepertools.uk/fathom-review-2026-xero-reporting-uk-bookkeepers/)
- [Clockwork: forecasting software for accounting firms](https://www.clockwork.ai/blog/cash-flow-forecasting-software-accounting-firms)
- [Smart Manufacture: MRPeasy vs Katana](https://www.smartmanufacture.co.uk/mrpeasy-vs-katana-which-mrp-system-suits-a-uk-manufacturer/)
- [TotalControlPro: manufacturing job tracking software](https://totalcontrolpro.com/blog/best-manufacturing-job-tracking-software-affordable-small-business/)
