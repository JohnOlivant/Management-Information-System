-- Read-only access for the MIS to Timesheets (database rule29_timesheets_demo). Run as postgres after the role exists.
-- The hours report needs the first three; the Timesheet report also reads workers, periods, codes, activities and claims.
-- Where the hours went reads only whether leave was holiday or sickness, not its notes.
-- Receipts, accounts, sessions and settings are not readable.
GRANT CONNECT ON DATABASE :"DBNAME" TO rule29_mis_reader;
GRANT USAGE ON SCHEMA timesheet TO rule29_mis_reader;
GRANT SELECT ON timesheet.time_entries, timesheet.submissions, timesheet.jobs, timesheet.workers, timesheet.pay_periods,
  timesheet.codes, timesheet.activities, timesheet.subsistence_claims, timesheet.subsistence_types,
  timesheet.expense_lines, timesheet.expense_categories TO rule29_mis_reader;
GRANT SELECT (id, kind) ON timesheet.leave_requests TO rule29_mis_reader;
