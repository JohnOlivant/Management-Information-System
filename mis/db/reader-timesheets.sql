-- Read-only access for the MIS to Timesheets (database rule29_timesheets_demo). Run as postgres after the role exists.
GRANT CONNECT ON DATABASE :"DBNAME" TO rule29_mis_reader;
GRANT USAGE ON SCHEMA timesheet TO rule29_mis_reader;
GRANT SELECT ON timesheet.time_entries, timesheet.submissions, timesheet.jobs TO rule29_mis_reader;
