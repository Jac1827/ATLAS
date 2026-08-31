(function () {
  "use strict";

  const STORAGE_KEY = "atlas_central_services_phase1_v2";
  const LEGACY_STORAGE_KEYS = ["atlas_central_services_phase1_v1"];
  const TODAY_ISO = new Date().toISOString().slice(0, 10);
  const MONTH_LABELS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];
  const MODULES = [
    ["overview", "Overview", "squares-four"],
    ["renewals", "Renewals", "arrows-clockwise"],
    ["moveOuts", "Move-Outs", "door-open"],
    ["inspections", "Inspections", "clipboard-text"],
    ["morfs", "MORFs", "files"],
    ["chargebacks", "Chargebacks", "currency-dollar"],
    ["collections", "Collections", "phone-call"],
    ["evictions", "Evictions", "gavel"],
    ["vendors", "Vendors", "truck"],
    ["invoices", "Invoices", "receipt"],
    ["compliance", "Compliance", "shield-check"],
    ["disputes", "Disputes", "chats-circle"],
    ["archive", "Archived MORFs", "archive-box"],
    ["tasks", "Work Queue", "check-square"],
    ["settings", "Settings", "gear-six"],
    ["architecture", "Architecture", "blueprint"],
    ["questions", "Build Questions", "question"]
  ];
  const EMPTY_ARRAY_KEYS = [
    "renewals",
    "moveOutCases",
    "inspections",
    "morfRecords",
    "tasks",
    "purchaseOrders",
    "collections",
    "evictions",
    "invoices",
    "vendorProfiles",
    "vendorInfractions",
    "residentDisputes",
    "inspectionSyncQueue",
    "notifications",
    "auditTrail",
    "importHistory",
    "accountingContacts",
    "potentialMoveOutUpdates"
  ];
  const RENEWAL_STATUS_OPTIONS = [
    "Pending Decision",
    "Offer Sent",
    "Follow-Up Due",
    "Renewal Signed",
    "Transfer",
    "On Notice",
    "Notice to Vacate",
    "NTV Received"
  ];
  const MOVE_OUT_STEPS = [
    "On Notice",
    "Upcoming Move Out",
    "Possession Confirmed",
    "Move-Out Inspection",
    "Inspection Approval",
    "MORF Ready",
    "MORF In Progress",
    "MORF Finalized",
    "Sent to Accounting",
    "Archived / Open",
    "MORF Closed"
  ];
  const HOLD_OVER_STEPS = [
    "Upcoming Move Out",
    "Hold Over / Past Due Move Out",
    "Inspection Hold - Possession Not Returned",
    "Resident Notification / Date Adjustment / Memo",
    "Possession Confirmed",
    "Move-Out Inspection"
  ];
  const MOVE_OUT_STATUS_ALIASES = {
    "ntv received": "On Notice",
    "mog required": "On Notice",
    "mog sent": "On Notice",
    "awaiting signature": "On Notice",
    "mog completed": "Upcoming Move Out",
    "inspection scheduled": "Move-Out Inspection",
    "inspection pending": "Move-Out Inspection",
    "inspection completed": "Inspection Approval",
    "inspection review pending": "Inspection Approval",
    "ready for morf": "MORF Ready",
    "morf/soda required": "MORF Ready",
    "morf/soda completed": "MORF Finalized",
    "approved": "MORF Finalized",
    "accounting confirmed": "Archived / Open",
    "closed": "MORF Closed",
    "final / locked": "MORF Closed"
  };
  const INSPECTION_TEMPLATE_NAMES = [
    "Move-Out Inspection",
    "Move-In Inspection",
    "Unit Condition / Routine Inspection",
    "Incident Report",
    "Damage Inspection",
    "Preventive Maintenance",
    "Common Area Inspection",
    "Safety / Risk Inspection",
    "Vendor Quality Inspection",
    "Turn Inspection",
    "Other / Custom"
  ];
  const DEFAULT_CONDITION_CHOICES = [
    "Excellent",
    "Good",
    "Normal Wear",
    "Cleaning Required",
    "Repair Required",
    "Replace",
    "Damaged",
    "Missing",
    "Safety Concern",
    "Not Applicable"
  ];
  const DEFAULT_ROOM_LIBRARY = [
    "Entry",
    "Living Room",
    "Dining Room",
    "Kitchen",
    "Primary Bedroom",
    "Bedroom 2",
    "Bedroom 3",
    "Bedroom 4",
    "Bathroom 1",
    "Bathroom 2",
    "Bathroom 3",
    "Laundry",
    "Hallway",
    "Closets",
    "Pantry",
    "Patio/Balcony",
    "Garage",
    "Exterior",
    "Utility/Mechanical",
    "Other"
  ];
  const DEFAULT_COMPONENT_LIBRARY = [
    "Cabinets",
    "Countertops",
    "Sink",
    "Faucet",
    "Refrigerator",
    "Range",
    "Microwave",
    "Dishwasher",
    "Flooring",
    "Walls",
    "Ceiling",
    "Lighting",
    "Blinds",
    "Windows",
    "Doors",
    "Hardware",
    "Smoke Detector",
    "Thermostat",
    "Plumbing Fixture",
    "Electrical",
    "Appliance",
    "Trash / Debris",
    "Other"
  ];
  const COMMON_AREA_TYPES = [
    "Clubhouse",
    "Fitness Center",
    "Pool",
    "Leasing Office",
    "Hallway",
    "Stairwell",
    "Elevator",
    "Dog Park",
    "Garage",
    "Parking Lot",
    "Mailroom",
    "Trash Area",
    "Grounds",
    "Exterior",
    "Mechanical Room",
    "Storage",
    "Other"
  ];
  const INSPECTION_STATUSES = [
    "Draft",
    "Submitted",
    "Awaiting Review",
    "Under Review",
    "Reviewed / Approved",
    "Approved",
    "Changes Requested",
    "Final",
    "HOLD - POSSESSION NOT RETURNED"
  ];
  const INSPECTION_APPROVED_STATUSES = ["Reviewed / Approved", "Approved", "Final"];
  const INSPECTION_SYNC_STATUSES = [
    "Saved Offline",
    "Waiting to Sync",
    "Syncing",
    "Successfully Synced",
    "Sync Error - Action Required"
  ];
  const RESIDENT_RESPONSIBILITY_OPTIONS = [
    "No",
    "Needs Review",
    "Recommended"
  ];
  const MORF_STATUSES = [
    "Not Started",
    "Inspection Pending",
    "Inspection Review Pending",
    "Draft - Inspection Approval Required",
    "Inspection Approval Required",
    "Ready for MORF",
    "MORF Ready",
    "MORF In Progress",
    "Waiting on Site",
    "Waiting on Utilities",
    "Waiting on Documentation",
    "Waiting on Information",
    "Legal Deadline Risk",
    "Ready for Final Review",
    "Approved",
    "MORF Finalized",
    "Sent to Accounting",
    "Archived / Open",
    "Resident Statement Sent",
    "Dispute Open",
    "In Dispute Review",
    "Dispute Closed",
    "Dispute / Review",
    "MORF Closed",
    "Final / Locked"
  ];
  const MORF_ACTIVE_STATUSES = [
    "Not Started",
    "Inspection Pending",
    "Inspection Review Pending",
    "Draft - Inspection Approval Required",
    "Inspection Approval Required",
    "Ready for MORF",
    "MORF Ready",
    "MORF In Progress",
    "Waiting on Site",
    "Waiting on Utilities",
    "Waiting on Documentation",
    "Waiting on Information",
    "Legal Deadline Risk",
    "Ready for Final Review",
    "Approved",
    "MORF Finalized"
  ];
  const ARCHIVE_STATUS_OPTIONS = [
    "Sent to Accounting / Open",
    "Dispute Open",
    "In Dispute Review",
    "Dispute Closed",
    "MORF Closed"
  ];
  const DISPUTE_STATUSES = [
    "Dispute Open",
    "In Dispute Review",
    "Dispute Closed",
    "MORF Closed"
  ];
  const WORKFLOW_BUCKET_CONFIGS = [
    ["upcoming", "Upcoming Move Outs / Upcoming MORFs", "Residents on notice waiting for scheduled move-out or possession confirmation.", "calendar-dots", "teal"],
    ["holdover", "Hold Over / Past Due Move Outs", "Possession was expected but has not been confirmed.", "warning-circle", "red"],
    ["inspections", "Move-Out Inspections", "Possession is confirmed and the field inspection can be processed.", "clipboard-text", "violet"],
    ["approval", "Inspection Approval", "Submitted inspections awaiting Central Services review or correction.", "stamp", "amber"],
    ["morfReady", "MORFs Ready for Processing", "Inspection is approved; MORF work can start before every ledger item is final.", "files", "green"],
    ["morfInProgress", "MORFs In Progress", "Central Services is actively completing or finalizing the MORF.", "pencil-simple-line", "violet"],
    ["waiting", "Waiting on Information", "The record needs site, utility, ledger, documentation, or forwarding-address follow-up.", "hourglass", "amber"],
    ["risk", "Legal Deadline Risk", "State deadline is close or overdue based on actual possession.", "alarm", "red"],
    ["sent", "Sent to Accounting", "Final package has been handed to Accounting and timestamped.", "paper-plane-tilt", "teal"],
    ["archived", "Archived MORFs", "Searchable closed or post-handoff move-out records.", "archive-box", "green"]
  ];
  const CENTRAL_DASHBOARD_CORE_WIDGETS = [
    "my_work",
    "legal_deadline_risk",
    "holdover_move_outs",
    "po_regional_approval",
    "upcoming_move_outs",
    "move_out_inspections",
    "inspection_approval",
    "morfs_ready",
    "morfs_in_progress",
    "invoice_confirmation",
    "vendor_infractions",
    "sent_to_accounting"
  ];
  const CENTRAL_DASHBOARD_OPTIONAL_WIDGETS = [
    "archived_morfs",
    "disputes",
    "sla_exceptions",
    "waiting_information",
    "task_aging",
    "morf_pipeline",
    "renewal_pipeline",
    "po_approval_aging",
    "regional_approval_performance",
    "vendor_workload",
    "vendor_rankings",
    "inspection_escalations",
    "inspection_repairs",
    "warranty_callbacks",
    "waiting_property",
    "waiting_regional",
    "waiting_vendor",
    "waiting_accounting",
    "waiting_resident"
  ];
  const CENTRAL_DASHBOARD_WIDGET_SIZES = [
    ["compact", "S"],
    ["standard", "M"],
    ["expanded", "L"],
    ["full", "XL"]
  ];
  const CENTRAL_DASHBOARD_VISUALIZATIONS = ["Table", "Cards", "Chart", "KPI", "Pipeline"];
  const CENTRAL_DASHBOARD_DATE_RANGES = [
    "All Open",
    "Today",
    "Overdue",
    "Next 7 Days",
    "Next 14 Days",
    "Next 30 Days",
    "Current Month",
    "Recently Completed"
  ];
  const CENTRAL_DASHBOARD_SORT_OPTIONS = [
    "Priority",
    "Due Date",
    "Days Remaining",
    "Days Overdue",
    "Newest",
    "Oldest",
    "Property",
    "Assigned User"
  ];
  const CENTRAL_DASHBOARD_SCOPE_OPTIONS = [
    ["current", "Current Central Services Scope"],
    ["assigned", "My Assigned Portfolio"],
    ["all", "All ATLAS Properties"],
    ["single", "Single Property"]
  ];
  const CENTRAL_DASHBOARD_PORTFOLIO_SCOPE_OPTIONS = [
    ["assigned", "Assigned Portfolio"],
    ["all", "All Portfolios"],
    ["current", "Current ATLAS Portfolio"]
  ];
  const CENTRAL_DASHBOARD_AGING_FILTERS = [
    "All Ages",
    "Due Today",
    "1-2 Days",
    "3-5 Days",
    "6-10 Days",
    "Over 10 Days"
  ];
  const CENTRAL_DASHBOARD_WIDGETS = [
    {
      key: "my_work",
      label: "My Work",
      category: "Personal",
      module: "tasks",
      icon: "user-focus",
      tone: "teal",
      defaultSize: "expanded",
      defaultMetric: "Open Items",
      description: "Assigned tasks, due today, overdue, waiting, follow-up, and recently completed work for the logged-in user.",
      columns: ["Item", "Type", "Due", "Status", "Follow-Up"],
      visualizations: ["Table", "Cards", "KPI"]
    },
    {
      key: "legal_deadline_risk",
      label: "Legal Deadline Risk",
      category: "Exceptions",
      module: "moveOuts",
      filter: "risk",
      icon: "alarm",
      tone: "red",
      priority: true,
      defaultSize: "expanded",
      defaultMetric: "At Risk",
      description: "Move-out and MORF records approaching applicable state deposit-accounting deadlines.",
      columns: ["Resident", "Property / Unit", "Actual Possession", "State Deadline", "Days Remaining", "Stage", "Assigned"],
      visualizations: ["Table", "Cards", "KPI"]
    },
    {
      key: "holdover_move_outs",
      label: "Hold Over / Past Due Move Outs",
      category: "Exceptions",
      module: "moveOuts",
      filter: "holdover",
      icon: "warning-circle",
      tone: "red",
      priority: true,
      defaultSize: "expanded",
      defaultMetric: "Past Due",
      description: "Residents at or beyond expected move-out date without confirmed possession.",
      columns: ["Resident", "Property / Unit", "Original Move-Out", "Days Overdue", "Possession", "Last Communication", "Assigned"],
      visualizations: ["Table", "Cards", "KPI"]
    },
    {
      key: "po_regional_approval",
      label: "POs Awaiting Regional Approval",
      category: "Regional",
      module: "tasks",
      icon: "clipboard-text",
      tone: "amber",
      defaultSize: "standard",
      defaultMetric: "Awaiting Approval",
      description: "Purchase orders waiting on Regional Manager review, with nudge support.",
      columns: ["Property", "PO #", "Vendor", "Amount", "Submitted", "Regional", "Age", "Aging Status"],
      visualizations: ["Table", "Cards", "KPI"]
    },
    {
      key: "upcoming_move_outs",
      label: "Upcoming Move Outs / Upcoming MORFs",
      category: "Move-Outs",
      module: "moveOuts",
      filter: "upcoming",
      icon: "calendar-dots",
      tone: "teal",
      defaultSize: "expanded",
      defaultMetric: "Upcoming",
      description: "Residents on notice whose lifecycle has started before the inspection stage.",
      columns: ["Resident", "Property", "Unit", "Scheduled Move-Out", "Days", "Possession", "Inspection", "Assigned CS User"],
      visualizations: ["Table", "Cards", "KPI"]
    },
    {
      key: "move_out_inspections",
      label: "Move-Out Inspections",
      category: "Inspections",
      module: "inspections",
      filter: "inspections",
      icon: "clipboard-text",
      tone: "violet",
      defaultSize: "expanded",
      defaultMetric: "Due / Scheduled",
      description: "Upcoming, scheduled, due, and overdue move-out inspections.",
      columns: ["Resident", "Property / Unit", "Possession Returned", "Inspection Date", "Inspector", "Status", "Days Overdue"],
      visualizations: ["Table", "Cards", "KPI"]
    },
    {
      key: "inspection_approval",
      label: "Inspection Approval",
      category: "Inspections",
      module: "moveOuts",
      filter: "approval",
      icon: "stamp",
      tone: "amber",
      defaultSize: "expanded",
      defaultMetric: "Awaiting Review",
      description: "Completed move-out inspections awaiting Central Services charge/documentation review.",
      columns: ["Resident", "Property / Unit", "Inspector", "Completed", "Charges", "Charge Total", "Warnings", "Approval"],
      visualizations: ["Table", "Cards", "KPI"]
    },
    {
      key: "morfs_ready",
      label: "MORFs Ready for Processing",
      category: "MORFs",
      module: "morfs",
      filter: "morfReady",
      icon: "files",
      tone: "green",
      defaultSize: "expanded",
      defaultMetric: "Ready",
      description: "Approved inspections with MORFs available for Central Services processing.",
      columns: ["Resident", "Property / Unit", "Actual Possession", "Internal Due", "State Deadline", "Days Remaining", "Deposit", "Preliminary Charges", "Processor"],
      visualizations: ["Table", "Cards", "KPI"]
    },
    {
      key: "morfs_in_progress",
      label: "MORFs In Progress",
      category: "MORFs",
      module: "morfs",
      filter: "morfInProgress",
      icon: "pencil-simple-line",
      tone: "violet",
      defaultSize: "expanded",
      defaultMetric: "In Progress",
      description: "MORFs Central Services has started but not finalized.",
      columns: ["Resident", "Property / Unit", "Processor", "Started", "Internal Deadline", "Legal Deadline", "Missing Information", "Status"],
      visualizations: ["Table", "Cards", "KPI"]
    },
    {
      key: "invoice_confirmation",
      label: "Invoices Awaiting Confirmation",
      category: "Invoices",
      module: "invoices",
      icon: "receipt",
      tone: "amber",
      defaultSize: "expanded",
      defaultMetric: "Needs Confirmation",
      description: "Invoices requiring work confirmation or quality review before approval.",
      columns: ["Vendor", "Vendor Code", "Property / Location", "WO / PO", "Amount", "Completed", "Reviewer", "Age"],
      visualizations: ["Table", "Cards", "KPI"]
    },
    {
      key: "vendor_infractions",
      label: "Open Vendor Infractions",
      category: "Vendors",
      module: "vendors",
      icon: "seal-warning",
      tone: "red",
      defaultSize: "standard",
      defaultMetric: "Open Issues",
      description: "Active vendor quality and compliance problems requiring Central Services attention.",
      columns: ["Vendor", "Vendor Code", "Property", "Category", "Severity", "Related Record", "Opened", "Status"],
      visualizations: ["Table", "Cards", "KPI"]
    },
    {
      key: "sent_to_accounting",
      label: "Sent to Accounting",
      category: "Archive",
      module: "archive",
      filter: "Sent to Accounting / Open",
      icon: "paper-plane-tilt",
      tone: "teal",
      defaultSize: "expanded",
      defaultMetric: "Recent Handoffs",
      description: "Recently finalized MORFs handed off to Accounting and archived for follow-up.",
      columns: ["Resident", "Property / Unit", "Processor", "Sent", "Refund / Balance", "State Deadline", "Send-By", "Archive Status"],
      visualizations: ["Table", "Cards", "KPI"]
    },
    {
      key: "archived_morfs",
      label: "Archived MORFs",
      category: "Archive",
      module: "archive",
      icon: "archive-box",
      tone: "green",
      optional: true,
      description: "Searchable post-handoff and closed MORF records.",
      columns: ["Resident", "Property / Unit", "Move-Out", "Sent", "Archive Status"],
      visualizations: ["Table", "Cards", "KPI"]
    },
    {
      key: "disputes",
      label: "Disputes",
      category: "Archive",
      module: "disputes",
      icon: "chats-circle",
      tone: "amber",
      optional: true,
      description: "Open resident disputes and statement revision records.",
      columns: ["Resident", "Property / Unit", "Status", "Version", "Amount", "Opened"],
      visualizations: ["Table", "Cards", "KPI"]
    },
    {
      key: "sla_exceptions",
      label: "SLA Exceptions",
      category: "Exceptions",
      module: "tasks",
      icon: "timer",
      tone: "red",
      optional: true,
      description: "Tasks, MORFs, inspections, and handoffs outside internal service targets.",
      columns: ["Item", "Property / Unit", "Owner", "Due", "Age", "Status"],
      visualizations: ["Table", "Cards", "KPI"]
    },
    {
      key: "waiting_information",
      label: "Waiting on Information",
      category: "Exceptions",
      module: "moveOuts",
      filter: "waiting",
      icon: "hourglass",
      tone: "amber",
      optional: true,
      description: "Move-out and MORF records waiting on site, utility, resident, accounting, or documentation details.",
      columns: ["Resident", "Property / Unit", "Needed From", "Status", "Assigned", "Due"],
      visualizations: ["Table", "Cards", "KPI"]
    },
    {
      key: "task_aging",
      label: "Central Services Task Aging",
      category: "Personal",
      module: "tasks",
      icon: "chart-bar",
      tone: "teal",
      optional: true,
      description: "Open Central Services task volume by age and owner.",
      columns: ["Task", "Property", "Owner", "Due", "Age", "Status"],
      visualizations: ["Table", "Cards", "Pipeline", "KPI"]
    },
    {
      key: "morf_pipeline",
      label: "MORF Pipeline",
      category: "MORFs",
      module: "morfs",
      icon: "git-branch",
      tone: "violet",
      optional: true,
      description: "MORF lifecycle volume by ready, in-progress, waiting, risk, sent, and archive stage.",
      columns: ["Stage", "Count", "Open Records"],
      visualizations: ["Pipeline", "Table", "KPI"]
    },
    {
      key: "renewal_pipeline",
      label: "Renewal Pipeline",
      category: "Move-Outs",
      module: "renewals",
      icon: "arrows-clockwise",
      tone: "teal",
      optional: true,
      description: "Renewal status and notice exposure feeding move-out lifecycle creation.",
      columns: ["Status", "Count", "Period"],
      visualizations: ["Pipeline", "Table", "KPI"]
    },
    {
      key: "po_approval_aging",
      label: "PO Approval Aging",
      category: "Regional",
      module: "tasks",
      icon: "clock-countdown",
      tone: "amber",
      optional: true,
      description: "Regional PO approval aging by submitted date.",
      columns: ["Property", "PO #", "Regional", "Age", "Status"],
      visualizations: ["Table", "Cards", "Pipeline", "KPI"]
    },
    {
      key: "regional_approval_performance",
      label: "Regional Approval Performance",
      category: "Regional",
      module: "tasks",
      icon: "chart-line-up",
      tone: "green",
      optional: true,
      description: "Regional approval workload and aging performance.",
      columns: ["Regional", "Open", "Overdue", "Oldest Age"],
      visualizations: ["Table", "Cards", "KPI"]
    },
    {
      key: "vendor_workload",
      label: "Vendor Workload",
      category: "Vendors",
      module: "vendors",
      icon: "truck",
      tone: "teal",
      optional: true,
      description: "Vendor open work order load across the selected scope.",
      columns: ["Vendor", "Vendor Code", "Open Work", "Completed", "Compliance"],
      visualizations: ["Table", "Cards", "KPI"]
    },
    {
      key: "vendor_rankings",
      label: "Vendor Performance Rankings",
      category: "Vendors",
      module: "vendors",
      icon: "medal",
      tone: "green",
      optional: true,
      description: "Vendor performance score, quality, reliability, compliance, and callback risk.",
      columns: ["Vendor", "Score", "Quality", "Reliability", "Compliance", "Callbacks"],
      visualizations: ["Table", "Cards", "KPI"]
    },
    {
      key: "inspection_escalations",
      label: "Inspection Escalations",
      category: "Inspections",
      module: "inspections",
      icon: "warning",
      tone: "red",
      optional: true,
      description: "Inspections with safety, documentation, photo, or resident-charge escalation warnings.",
      columns: ["Inspection", "Property / Unit", "Inspector", "Issue", "Status"],
      visualizations: ["Table", "Cards", "KPI"]
    },
    {
      key: "inspection_repairs",
      label: "Open Inspection Repairs",
      category: "Inspections",
      module: "inspections",
      icon: "wrench",
      tone: "amber",
      optional: true,
      description: "Inspection findings routed to work task or repair follow-up.",
      columns: ["Finding", "Property / Unit", "Assigned", "Status", "Inspection"],
      visualizations: ["Table", "Cards", "KPI"]
    },
    {
      key: "warranty_callbacks",
      label: "Warranty / Callback Requests",
      category: "Vendors",
      module: "vendors",
      icon: "arrow-counter-clockwise",
      tone: "amber",
      optional: true,
      description: "Vendors or work tied to warranty callbacks and resident complaints.",
      columns: ["Vendor", "Property", "Callbacks", "Complaints", "Status"],
      visualizations: ["Table", "Cards", "KPI"]
    },
    {
      key: "waiting_property",
      label: "Tasks Waiting on Property",
      category: "Waiting",
      module: "tasks",
      icon: "buildings",
      tone: "amber",
      optional: true,
      description: "Open work waiting on property team action.",
      columns: ["Task", "Property", "Owner", "Due", "Status"],
      visualizations: ["Table", "Cards", "KPI"]
    },
    {
      key: "waiting_regional",
      label: "Tasks Waiting on Regional",
      category: "Waiting",
      module: "tasks",
      icon: "users-three",
      tone: "amber",
      optional: true,
      description: "Open work waiting on Regional Manager action.",
      columns: ["Task", "Property", "Regional", "Due", "Status"],
      visualizations: ["Table", "Cards", "KPI"]
    },
    {
      key: "waiting_vendor",
      label: "Tasks Waiting on Vendor",
      category: "Waiting",
      module: "tasks",
      icon: "truck",
      tone: "amber",
      optional: true,
      description: "Open work waiting on vendor response or completion.",
      columns: ["Task", "Property", "Vendor", "Due", "Status"],
      visualizations: ["Table", "Cards", "KPI"]
    },
    {
      key: "waiting_accounting",
      label: "Tasks Waiting on Accounting",
      category: "Waiting",
      module: "tasks",
      icon: "calculator",
      tone: "amber",
      optional: true,
      description: "Open work waiting on Accounting response or handoff confirmation.",
      columns: ["Task", "Property", "Owner", "Due", "Status"],
      visualizations: ["Table", "Cards", "KPI"]
    },
    {
      key: "waiting_resident",
      label: "Tasks Waiting on Resident",
      category: "Waiting",
      module: "tasks",
      icon: "user",
      tone: "amber",
      optional: true,
      description: "Open work waiting on resident response, possession, forwarding address, or dispute information.",
      columns: ["Task", "Resident", "Property / Unit", "Due", "Status"],
      visualizations: ["Table", "Cards", "KPI"]
    }
  ];
  let centralDashboardDraggedInstanceId = "";
  const CHARGE_TYPES = [
    "Full Replacement",
    "Repair",
    "Cleaning",
    "Touch-Up",
    "Partial Replacement",
    "Labor Only",
    "Materials Only",
    "Custom Charge"
  ];
  const DEFAULT_VENDOR_SKILLS = [
    "HVAC",
    "Plumbing",
    "Electrical",
    "Appliances",
    "Painting",
    "Drywall",
    "Flooring",
    "Carpet",
    "Cleaning",
    "Turn Services",
    "Locksmith",
    "Doors",
    "Windows",
    "Roofing",
    "Landscaping",
    "Pest Control",
    "Pool",
    "Fire/Life Safety",
    "Restoration",
    "Water Mitigation",
    "General Contractor",
    "Handyman",
    "Other"
  ];
  const ACCOUNTING_PACKET_OPTIONS = [
    "Internal/Accounting MORF",
    "Statement of Deposit Accounting",
    "Turn / Damage Statement",
    "Inspection Report",
    "Damage Photos",
    "MOG",
    "Ledger",
    "Supporting documentation"
  ];
  const SYSTEM_RELATIONSHIP_CHAIN = [
    "Move-Out Lifecycle",
    "On Notice",
    "Possession",
    "Inspection",
    "Finding",
    "Resident Responsibility",
    "Charge Review",
    "MORF",
    "Statement",
    "Accounting",
    "Dispute",
    "Vendor Quality"
  ];
  const CENTRAL_DEPARTMENT_PATTERNS = [
    /\bcentral\s+services?\b/i,
    /\bcentra\b/i
  ];
  const RENEWAL_FIELD_ALIASES = {
    residentName: ["resident name", "resident", "name", "primary resident", "lease holder", "tenant name"],
    residentId: ["resident id", "residentid", "tenant id", "customer id"],
    leaseId: ["lease id", "leaseid", "lease number"],
    unit: ["unit", "apartment", "apt", "apartment number", "unit number"],
    unitType: ["unit type", "floor plan", "floorplan", "bed bath"],
    moveInDate: ["move-in date", "move in date", "move-in", "move in", "lease start", "lease start date"],
    expirationDate: ["expiration date", "lease expiration", "lease end", "lease end date", "expire date"],
    notice90Date: ["90 day notice date", "90-day notice date", "90 day", "90-day"],
    notice60Date: ["60 day notice date", "60-day notice date", "60 day", "60-day"],
    notice30Date: ["30 day notice date", "30-day notice date", "30 day", "30-day"],
    depositHeld: ["deposit held", "deposit", "security deposit"],
    currentRate: ["current rate", "current rent", "rent"],
    recommendedOffer: ["recommended offer", "renewal offer", "recommended renewal offer"],
    investorOverridePct: ["investor override % increase", "investor override percent", "override %"],
    investorOverrideOffer: ["investor override offer", "override offer"],
    offer1: ["offer 1 - conservative", "offer 1", "conservative offer"],
    offer2: ["offer 2 - balanced", "offer 2", "balanced offer"],
    offer3: ["offer 3 - aggressive", "offer 3", "aggressive offer"],
    signedOffer: ["signed offer", "signed renewal rent", "new rent"],
    status: ["status", "renewal status", "decision", "response", "resident response"],
    renewalSigned: ["renewal signed", "signed", "renewed"],
    transfer: ["transfer", "transfer renewal"],
    ntvReceived: ["ntv received", "ntv rcvd", "ntv rcv'd", "ntv rcv d", "notice to vacate", "ntv", "notice received"],
    ntvReceivedDate: ["ntv received date", "ntv rcvd date", "ntv rcv'd date", "ntv rcv d", "notice received date", "notice date"],
    scheduledMoveOutDate: ["scheduled move-out date", "scheduled move out date", "scheduled move-out", "scheduled move out", "move-out date", "move out date", "move-out", "move out", "scheduled vacate date"],
    inspectionDate: ["inspection date", "scheduled inspection date", "move-out inspection", "move out inspection", "move-out inspection date", "move out inspection date"],
    phone: ["phone", "mobile", "cell", "resident phone"],
    email: ["email", "resident email", "e-mail"],
    forwardingAddress: ["forwarding address", "new address", "mailing address", "resident forwarding address"],
    assignedRegional: ["assigned regional", "regional", "regional manager", "rm"],
    assignedCentralServicesUser: ["assigned central services", "central services user", "cs owner", "processor"],
    communityEmail: ["community email", "property email", "site email", "leasing email"],
    notes: ["notes", "comments", "central services notes"],
    marketRate: ["market rate", "market rent"],
    budgetRate: ["budget rate", "budget rent"],
    occupancyPosition: ["occupancy - under / over", "occupancy position", "occupancy"],
    rentGrowthOffer1: ["rent growth - offer 1", "offer 1 growth"],
    rentGrowthOffer2: ["rent growth - offer 2", "offer 2 growth"],
    rentGrowthOffer3: ["rent growth - offer 3", "offer 3 growth"],
    signedRentGrowth: ["signed rent growth", "signed growth"]
  };

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function asObject(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  function cleanString(value) {
    return String(value ?? "").trim();
  }

  function normalizeKey(value) {
    return cleanString(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  function escapeHtml(value) {
    return cleanString(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }

  function numberValue(value) {
    if (value === null || value === undefined || value === "") return 0;
    if (typeof value === "number") return Number.isFinite(value) ? value : 0;
    const cleaned = cleanString(value).replace(/[$,%\s,]/g, "");
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function whole(value) {
    return Math.max(0, Math.round(numberValue(value)));
  }

  function formatNumber(value) {
    return whole(value).toLocaleString();
  }

  function formatMoney(value) {
    const numeric = numberValue(value);
    if (!numeric) return "";
    return numeric.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  }

  function formatPercent(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? `${numeric.toFixed(1)}%` : "n/a";
  }

  function formatDate(value) {
    const normalized = normalizeDate(value);
    if (!normalized) return "";
    const parsed = new Date(`${normalized}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return normalized;
    return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  function normalizeDate(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
    if (typeof value === "number" && Number.isFinite(value) && value > 20000 && value < 80000) {
      const excelEpoch = Date.UTC(1899, 11, 30);
      return new Date(excelEpoch + value * 86400000).toISOString().slice(0, 10);
    }
    const raw = cleanString(value);
    if (!raw) return "";
    const iso = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (iso) {
      const normalized = `${iso[1]}-${String(Number(iso[2])).padStart(2, "0")}-${String(Number(iso[3])).padStart(2, "0")}`;
      return Number.isNaN(Date.parse(`${normalized}T00:00:00`)) ? "" : normalized;
    }
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
  }

  function addDays(dateIso, days) {
    const base = normalizeDate(dateIso) || TODAY_ISO;
    const date = new Date(`${base}T00:00:00`);
    date.setDate(date.getDate() + days);
    return date.toISOString().slice(0, 10);
  }

  function daysUntil(dateIso) {
    const normalized = normalizeDate(dateIso);
    if (!normalized) return null;
    const today = new Date(`${TODAY_ISO}T00:00:00`).getTime();
    const target = new Date(`${normalized}T00:00:00`).getTime();
    return Math.ceil((target - today) / 86400000);
  }

  function simpleHash(value) {
    const source = cleanString(value);
    let hash = 0;
    for (let index = 0; index < source.length; index += 1) {
      hash = ((hash << 5) - hash + source.charCodeAt(index)) | 0;
    }
    return Math.abs(hash).toString(36);
  }

  function makeId(prefix, parts) {
    return `${prefix}_${simpleHash(asArray(parts).join("|"))}`;
  }

  function safeJsonParse(raw, fallback) {
    try {
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function storageGet(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function storageSet(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (error) {
      alert(`Central Services could not save this change: ${error?.message || error}`);
      return false;
    }
  }

  function removeLegacyStorage() {
    try {
      LEGACY_STORAGE_KEYS.forEach(key => localStorage.removeItem(key));
    } catch {
      // Browser storage may be unavailable in private or blocked contexts.
    }
  }

  function cleanIdSegment(value) {
    return normalizeKey(value).replace(/\s+/g, "_") || simpleHash(value);
  }

  function uniqueStrings(values) {
    const seen = new Set();
    const result = [];
    asArray(values).forEach(value => {
      const label = cleanString(value);
      const key = normalizeKey(label);
      if (!label || seen.has(key)) return;
      seen.add(key);
      result.push(label);
    });
    return result;
  }

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function defaultWorkflowSettings() {
    return {
      morfInternalBusinessDays: 5,
      defaultMarketZipMultiplier: 1,
      lockReviewBusinessDays: 30,
      mailingBufferBusinessDays: 7,
      companyHolidays: [],
      inspectionEligibleRoleSignals: [
        "Maintenance Supervisor",
        "Assistant Maintenance Supervisor",
        "Maintenance Technician",
        "Service Technician",
        "Maintenance Manager"
      ],
      accountingRoutingMode: "Portfolio Default -> Property Override",
      residentCopySuppressesAmounts: true,
      offlineSyncDedupeKey: "sourceInspectionId + deviceInspectionId + updatedAt"
    };
  }

  function makeInspectionTemplate(name, options = {}) {
    const sections = options.sections || [
      "Location",
      "Room-by-Room Condition",
      "Photos",
      "Findings",
      "Corrective Action",
      "Signatures",
      "Review"
    ];
    return {
      id: options.id || `tmpl_${cleanIdSegment(name)}`,
      name,
      category: options.category || "Operations",
      active: options.active !== false,
      sections: asArray(sections),
      requiredFields: asArray(options.requiredFields || ["propertyName", "locationType", "inspectionDate", "inspectorName"]),
      conditionChoices: asArray(options.conditionChoices || DEFAULT_CONDITION_CHOICES),
      requiredPhotos: options.requiredPhotos !== false,
      signatureRequirements: {
        inspector: options.inspectorSignature !== false,
        resident: options.residentSignature || "conditional",
        vendor: Boolean(options.vendorSignature),
        witness: Boolean(options.witnessSignature)
      },
      escalationRules: asArray(options.escalationRules || []),
      chargebackAvailability: options.chargebackAvailability !== false,
      vendorAssignmentAvailability: options.vendorAssignmentAvailability !== false,
      correctiveActionRequired: Boolean(options.correctiveActionRequired),
      approvalRequired: options.approvalRequired !== false,
      residentCopySuppressesAmounts: options.residentCopySuppressesAmounts !== false,
      createdBy: options.createdBy || "ATLAS system template",
      createdAt: options.createdAt || TODAY_ISO
    };
  }

  function defaultInspectionTemplates() {
    return [
      makeInspectionTemplate("Move-Out Inspection", {
        category: "Move-Out",
        requiredFields: ["propertyName", "unit", "residentName", "possessionReturnedDate", "inspectionDate", "inspectorName"],
        escalationRules: ["Resident chargebacks require Central Services review before MORF.", "Resident-attended copies suppress dollar amounts."],
        residentSignature: "resident_present_only"
      }),
      makeInspectionTemplate("Move-In Inspection", {
        category: "Resident",
        chargebackAvailability: false,
        residentSignature: "requested"
      }),
      makeInspectionTemplate("Unit Condition / Routine Inspection", {
        category: "Property",
        chargebackAvailability: false,
        residentSignature: "not_required"
      }),
      makeInspectionTemplate("Incident Report", {
        category: "Risk",
        sections: ["People Involved", "Witnesses", "Emergency Response", "Narrative", "Photos / Video", "Follow-Up Actions", "Risk Escalation", "Signatures"],
        requiredFields: ["propertyName", "locationType", "inspectionDate", "inspectorName", "narrative"],
        chargebackAvailability: false,
        witnessSignature: true,
        correctiveActionRequired: true,
        escalationRules: ["Legal/Risk escalation required when injury, police, fire, insurance, or life-safety fields are marked yes."]
      }),
      makeInspectionTemplate("Damage Inspection", {
        category: "Damage",
        correctiveActionRequired: true
      }),
      makeInspectionTemplate("Preventive Maintenance", {
        category: "Maintenance",
        chargebackAvailability: false,
        vendorAssignmentAvailability: true,
        residentSignature: "not_required"
      }),
      makeInspectionTemplate("Common Area Inspection", {
        category: "Property",
        chargebackAvailability: false,
        residentSignature: "not_required"
      }),
      makeInspectionTemplate("Safety / Risk Inspection", {
        category: "Risk",
        chargebackAvailability: false,
        correctiveActionRequired: true,
        escalationRules: ["Safety Concern findings require escalation or documented review."]
      }),
      makeInspectionTemplate("Vendor Quality Inspection", {
        category: "Vendor",
        chargebackAvailability: false,
        vendorSignature: true,
        correctiveActionRequired: true
      }),
      makeInspectionTemplate("Turn Inspection", {
        category: "Turn",
        correctiveActionRequired: true,
        residentSignature: "not_required"
      }),
      makeInspectionTemplate("Other / Custom", {
        category: "Custom",
        requiredPhotos: false,
        residentSignature: "configurable"
      })
    ];
  }

  function defaultChargebackCatalog() {
    const seeds = [
      ["Cleaning", "Standard cleaning", 125, 0, 125, 0, "Cleaning"],
      ["Cleaning", "Deep cleaning", 250, 0, 250, 0, "Cleaning"],
      ["Removal", "Trash removal", 150, 90, 60, 0, "Labor Only"],
      ["Removal", "Bulk-item removal", 225, 125, 100, 0, "Labor Only"],
      ["Paint", "Touch-up paint", 95, 65, 30, 24, "Touch-Up"],
      ["Paint", "Full repaint", 650, 420, 230, 24, "Full Replacement"],
      ["Walls", "Wall repair", 175, 95, 80, 0, "Repair"],
      ["Doors", "Door replacement", 325, 140, 185, 84, "Full Replacement"],
      ["Cabinets", "Cabinet repair", 225, 125, 100, 96, "Repair"],
      ["Counters", "Countertop damage", 475, 175, 300, 120, "Repair"],
      ["Windows", "Blind replacement", 95, 35, 60, 36, "Full Replacement"],
      ["Flooring", "Carpet cleaning", 175, 0, 175, 0, "Cleaning"],
      ["Flooring", "Carpet replacement", 1200, 350, 850, 60, "Full Replacement"],
      ["Flooring", "Flooring", 975, 300, 675, 84, "Full Replacement"],
      ["Appliance", "Appliance repair", 275, 150, 125, 84, "Repair"],
      ["Appliance", "Appliance replacement", 950, 250, 700, 84, "Full Replacement"],
      ["Access", "Key replacement", 75, 45, 30, 0, "Materials Only"],
      ["Access", "Fob replacement", 85, 25, 60, 0, "Materials Only"],
      ["Screens", "Screen repair", 125, 65, 60, 48, "Repair"],
      ["Plumbing", "Plumbing fixture", 185, 95, 90, 84, "Repair"],
      ["General", "Other", 0, 0, 0, 0, "Custom Charge"]
    ];
    return seeds.map(([category, item, portfolioCost, laborComponent, materialComponent, usefulLifeMonths, chargeType]) => ({
      id: `cb_${cleanIdSegment(`${category}_${item}`)}`,
      chargebackId: `CB-${cleanIdSegment(item).toUpperCase().slice(0, 18)}`,
      category,
      item,
      description: item,
      portfolioCost,
      marketAdjustment: 1,
      propertyOverrides: {},
      laborComponent,
      materialComponent,
      usefulLifeMonths,
      depreciationMethod: usefulLifeMonths ? "Configurable useful-life proration" : "Not depreciated by default",
      chargeType,
      effectiveDate: TODAY_ISO,
      active: true,
      lastUpdated: TODAY_ISO,
      updatedBy: "ATLAS default catalog"
    }));
  }

  function mergeConfigById(defaults, saved, normalizer) {
    const byId = new Map(asArray(defaults).map(item => [item.id, cloneJson(item)]));
    asArray(saved).forEach(item => {
      if (!item || typeof item !== "object") return;
      const normalized = normalizer ? normalizer(item) : item;
      if (!normalized.id) return;
      byId.set(normalized.id, {
        ...asObject(byId.get(normalized.id)),
        ...normalized
      });
    });
    return [...byId.values()];
  }

  function normalizeInspectionTemplate(template = {}) {
    const name = cleanString(template.name);
    if (!name) return {};
    return {
      ...template,
      id: cleanString(template.id) || `tmpl_${cleanIdSegment(name)}`,
      name,
      category: cleanString(template.category || "Custom"),
      active: template.active !== false,
      sections: uniqueStrings(template.sections).length ? uniqueStrings(template.sections) : ["Location", "Findings", "Signatures", "Review"],
      requiredFields: uniqueStrings(template.requiredFields),
      conditionChoices: uniqueStrings(template.conditionChoices).length ? uniqueStrings(template.conditionChoices) : DEFAULT_CONDITION_CHOICES,
      escalationRules: uniqueStrings(template.escalationRules),
      signatureRequirements: {
        inspector: template.signatureRequirements?.inspector !== false,
        resident: cleanString(template.signatureRequirements?.resident || template.residentSignature || "conditional"),
        vendor: Boolean(template.signatureRequirements?.vendor),
        witness: Boolean(template.signatureRequirements?.witness)
      },
      chargebackAvailability: template.chargebackAvailability !== false,
      vendorAssignmentAvailability: template.vendorAssignmentAvailability !== false,
      correctiveActionRequired: Boolean(template.correctiveActionRequired),
      approvalRequired: template.approvalRequired !== false,
      residentCopySuppressesAmounts: template.residentCopySuppressesAmounts !== false
    };
  }

  function normalizeChargebackCatalogItem(item = {}) {
    const label = cleanString(item.item || item.description);
    if (!label) return {};
    return {
      ...item,
      id: cleanString(item.id) || `cb_${cleanIdSegment(label)}`,
      chargebackId: cleanString(item.chargebackId) || `CB-${cleanIdSegment(label).toUpperCase().slice(0, 18)}`,
      category: cleanString(item.category || "General"),
      item: label,
      description: cleanString(item.description || label),
      portfolioCost: numberValue(item.portfolioCost),
      marketAdjustment: Number(item.marketAdjustment) > 0 ? Number(item.marketAdjustment) : 1,
      propertyOverrides: asObject(item.propertyOverrides),
      laborComponent: numberValue(item.laborComponent),
      materialComponent: numberValue(item.materialComponent),
      usefulLifeMonths: whole(item.usefulLifeMonths),
      depreciationMethod: cleanString(item.depreciationMethod || "Configurable by policy"),
      chargeType: CHARGE_TYPES.includes(item.chargeType) ? item.chargeType : "Custom Charge",
      effectiveDate: normalizeDate(item.effectiveDate) || TODAY_ISO,
      active: item.active !== false,
      lastUpdated: item.lastUpdated || TODAY_ISO,
      updatedBy: cleanString(item.updatedBy || "ATLAS")
    };
  }

  function normalizeStateComplianceRule(rule = {}) {
    const stateCode = cleanString(rule.state || rule.stateCode).toUpperCase().slice(0, 2);
    if (!stateCode) return {};
    return {
      ...rule,
      id: cleanString(rule.id) || makeId("compliance", [stateCode, rule.version || "v1"]),
      state: stateCode,
      requiredStatutoryWording: cleanString(rule.requiredStatutoryWording),
      depositAccountingDeadlineDays: whole(rule.depositAccountingDeadlineDays),
      calculationMethod: cleanString(rule.calculationMethod || "Legal configuration required"),
      dayRule: cleanString(rule.dayRule || "Legal configuration required"),
      mailingRequirements: cleanString(rule.mailingRequirements),
      electronicDeliveryRules: cleanString(rule.electronicDeliveryRules),
      certifiedMailRequirement: cleanString(rule.certifiedMailRequirement),
      forwardingAddressRules: cleanString(rule.forwardingAddressRules),
      documentationRequirements: cleanString(rule.documentationRequirements),
      disputeWindowDays: whole(rule.disputeWindowDays),
      statuteReference: cleanString(rule.statuteReference),
      effectiveDate: normalizeDate(rule.effectiveDate),
      lastReviewedDate: normalizeDate(rule.lastReviewedDate),
      reviewedBy: cleanString(rule.reviewedBy),
      version: cleanString(rule.version || "v1"),
      active: rule.active !== false
    };
  }

  function normalizeInspectionRecord(record = {}) {
    const id = cleanString(record.id) || makeId("inspection", [record.propertyName, record.unit, Date.now()]);
    return {
      ...record,
      id,
      status: INSPECTION_STATUSES.includes(record.status) ? record.status : "Draft",
      syncStatus: INSPECTION_SYNC_STATUSES.includes(record.syncStatus) ? record.syncStatus : "Saved Offline",
      inspectorEmployeeId: cleanString(record.inspectorEmployeeId),
      inspectorHomeProperty: cleanString(record.inspectorHomeProperty),
      inspectionProperty: cleanString(record.inspectionProperty || record.propertyName),
      temporaryOperationalAssignment: asObject(record.temporaryOperationalAssignment),
      assignmentHistory: asArray(record.assignmentHistory),
      findings: asArray(record.findings).map(finding => ({
        ...finding,
        id: cleanString(finding.id) || makeId("finding", [id, Date.now(), Math.random()]),
        photos: asArray(finding.photos),
        annotations: asArray(finding.annotations),
        chargeAudit: asArray(finding.chargeAudit)
      })),
      signatures: asArray(record.signatures),
      audit: asArray(record.audit)
    };
  }

  function normalizeMorfRecord(record = {}) {
    const archivedLike = Boolean(record.archivedAt) ||
      ["Sent to Accounting", "Archived / Open", "Final / Locked", "MORF Closed"].includes(record.status);
    const archiveStatus = ARCHIVE_STATUS_OPTIONS.includes(record.archiveStatus)
      ? record.archiveStatus
      : record.status === "Final / Locked" || record.status === "MORF Closed"
        ? "MORF Closed"
        : record.status === "Dispute / Review" || record.status === "Dispute Open"
          ? "Dispute Open"
          : archivedLike
            ? "Sent to Accounting / Open"
            : "";
    return {
      ...record,
      id: cleanString(record.id) || makeId("morf", [record.moveOutCaseId, record.propertyName, record.unit]),
      status: MORF_STATUSES.includes(record.status) ? record.status : "Not Started",
      charges: asArray(record.charges),
      deposits: asArray(record.deposits),
      credits: asArray(record.credits),
      finalUtilities: asArray(record.finalUtilities),
      finalRent: asArray(record.finalRent),
      recurringCharges: asArray(record.recurringCharges),
      pastDueCharges: asArray(record.pastDueCharges),
      forwardingAddresses: asArray(record.forwardingAddresses),
      packetSelections: asArray(record.packetSelections),
      statementVersions: asArray(record.statementVersions),
      mogUploads: asArray(record.mogUploads),
      generatedArtifacts: asArray(record.generatedArtifacts),
      delivery: asObject(record.delivery),
      accountingHandoff: asObject(record.accountingHandoff),
      archiveStatus,
      lifecycleTimestamps: asObject(record.lifecycleTimestamps),
      audit: asArray(record.audit)
    };
  }

  function normalizeLifecycleStatus(status) {
    const direct = cleanString(status);
    if (MOVE_OUT_STEPS.includes(direct) || HOLD_OVER_STEPS.includes(direct)) return direct;
    return MOVE_OUT_STATUS_ALIASES[normalizeKey(direct)] || direct || "On Notice";
  }

  function normalizeMoveOutCaseRecord(record = {}) {
    const scheduledMoveOutDate = normalizeDate(record.scheduledMoveOutDate || record.moveOutDate);
    const actualPossession = normalizeDate(record.actualPossessionReturnedDate || record.possessionReturnedDate);
    const id = cleanString(record.id) || makeId("moveout", [
      record.residentId,
      record.leaseId,
      record.propertyName,
      record.unit,
      scheduledMoveOutDate || record.leaseExpiration
    ]);
    const workflowStatus = normalizeLifecycleStatus(record.workflowStatus || record.lifecycleStatus);
    return {
      ...record,
      id,
      lifecycleRecordType: "Move-Out Lifecycle Record",
      workflowStatus,
      lifecycleStatus: workflowStatus,
      source: cleanString(record.source || "central_services"),
      residentName: cleanString(record.residentName),
      residentId: cleanString(record.residentId),
      leaseId: cleanString(record.leaseId),
      propertyName: cleanString(record.propertyName),
      unit: cleanString(record.unit),
      unitType: cleanString(record.unitType),
      moveInDate: normalizeDate(record.moveInDate),
      leaseExpiration: normalizeDate(record.leaseExpiration || record.expirationDate),
      ntvReceivedDate: normalizeDate(record.ntvReceivedDate || record.noticeDate),
      noticeDate: normalizeDate(record.noticeDate || record.ntvReceivedDate),
      scheduledMoveOutDate,
      anticipatedPossessionDate: normalizeDate(record.anticipatedPossessionDate),
      actualPossessionReturnedDate: actualPossession,
      possessionReturnedDate: actualPossession,
      possessionStatus: cleanString(record.possessionStatus || (actualPossession ? "Returned" : "Not Confirmed")),
      inspectionDate: normalizeDate(record.inspectionDate),
      inspectorName: cleanString(record.inspectorName || "Unassigned"),
      inspectorEmployeeId: cleanString(record.inspectorEmployeeId),
      inspectorHomeProperty: cleanString(record.inspectorHomeProperty),
      temporaryInspectionAssignment: asObject(record.temporaryInspectionAssignment),
      inspectionAssignmentHistory: asArray(record.inspectionAssignmentHistory),
      inspectionStatus: cleanString(record.inspectionStatus || "Not Scheduled"),
      inspectionApprovalStatus: cleanString(record.inspectionApprovalStatus || "Inspection Pending"),
      morfSodaStatus: cleanString(record.morfSodaStatus || "Not Started"),
      accountingStatus: cleanString(record.accountingStatus || "Not Sent"),
      depositHeld: numberValue(record.depositHeld),
      phone: cleanString(record.phone),
      email: cleanString(record.email).toLowerCase(),
      forwardingAddress: cleanString(record.forwardingAddress),
      communityEmail: cleanString(record.communityEmail || record.propertyEmail).toLowerCase(),
      assignedRegional: cleanString(record.assignedRegional),
      owner: cleanString(record.owner || record.assignedCentralServicesUser || "Unassigned"),
      assignedCentralServicesUser: cleanString(record.assignedCentralServicesUser || record.owner || "Unassigned"),
      notes: cleanString(record.notes),
      memos: asArray(record.memos),
      communications: asArray(record.communications),
      dateAdjustments: asArray(record.dateAdjustments),
      potentialUpdates: asArray(record.potentialUpdates),
      mogUploads: asArray(record.mogUploads),
      accountingHandoff: asObject(record.accountingHandoff),
      lifecycleTimestamps: asObject(record.lifecycleTimestamps),
      activity: asArray(record.activity)
    };
  }

  function normalizeVendorProfile(profile = {}) {
    const name = cleanString(profile.name || profile.vendorName);
    if (!name) return {};
    return {
      ...profile,
      id: cleanString(profile.id) || makeId("vendor", [name, profile.entrataVendorCode]),
      name,
      entrataVendorCode: cleanString(profile.entrataVendorCode),
      active: profile.active !== false,
      propertiesServed: uniqueStrings(profile.propertiesServed),
      marketsServed: uniqueStrings(profile.marketsServed),
      serviceAreas: uniqueStrings(profile.serviceAreas),
      skills: uniqueStrings(profile.skills),
      complianceStatus: cleanString(profile.complianceStatus || "Review Required"),
      insuranceExpiration: normalizeDate(profile.insuranceExpiration),
      contactName: cleanString(profile.contactName),
      contactEmail: cleanString(profile.contactEmail).toLowerCase(),
      qualityScore: whole(profile.qualityScore),
      costScore: whole(profile.costScore),
      reliabilityScore: whole(profile.reliabilityScore),
      complianceScore: whole(profile.complianceScore),
      openWorkOrders: whole(profile.openWorkOrders),
      completedWorkOrders: whole(profile.completedWorkOrders),
      warrantyCallbacks: whole(profile.warrantyCallbacks),
      vendorInfractions: whole(profile.vendorInfractions),
      residentComplaints: whole(profile.residentComplaints),
      preferredPropertyVendor: Boolean(profile.preferredPropertyVendor),
      preferredPortfolioVendor: Boolean(profile.preferredPortfolioVendor),
      adminOverridePreferred: Boolean(profile.adminOverridePreferred)
    };
  }

  function normalizeDisputeRecord(record = {}) {
    const status = DISPUTE_STATUSES.includes(record.status)
      ? record.status
      : record.status === "Open"
        ? "Dispute Open"
        : record.status === "Final / Locked" || record.status === "Closed"
          ? "Dispute Closed"
          : cleanString(record.status || "Dispute Open");
    return {
      ...record,
      id: cleanString(record.id) || makeId("dispute", [record.morfId, Date.now()]),
      status,
      versions: asArray(record.versions),
      correspondence: asArray(record.correspondence),
      audit: asArray(record.audit)
    };
  }

  function getCentralDashboardWidgetDefinition(widgetKey = "") {
    const key = cleanString(widgetKey);
    return CENTRAL_DASHBOARD_WIDGETS.find(widget => widget.key === key) || null;
  }

  function centralDashboardWidgetIsAvailable(widget = {}) {
    return Boolean(widget?.key);
  }

  function centralDashboardUserKey() {
    const actor = currentActor();
    const raw = cleanString(actor.userId || actor.email || actor.name);
    return raw && raw !== "central-services" ? raw : "local-central-services-user";
  }

  function normalizeCentralDashboardSize(size) {
    return CENTRAL_DASHBOARD_WIDGET_SIZES.some(([key]) => key === size) ? size : "standard";
  }

  function centralDashboardVisualizationOptions(definition = {}) {
    const configured = asArray(definition.visualizations).length ? definition.visualizations : CENTRAL_DASHBOARD_VISUALIZATIONS;
    return uniqueStrings([...configured, "Chart"]);
  }

  function normalizeCentralDashboardVisualization(value, definition = {}) {
    const allowed = centralDashboardVisualizationOptions(definition);
    return allowed.includes(value) ? value : allowed[0] || "Table";
  }

  function buildCentralDashboardWidgetInstance(widgetKey = "", index = 0, options = {}) {
    const definition = getCentralDashboardWidgetDefinition(widgetKey) || CENTRAL_DASHBOARD_WIDGETS[0];
    const instanceId = cleanString(options.instanceId || options.instance_id) || `cs_widget_${definition.key}_${index + 1}`;
    return {
      instanceId,
      widgetKey: definition.key,
      position: Number.isFinite(Number(options.position)) ? Number(options.position) : index,
      size: normalizeCentralDashboardSize(options.size || definition.defaultSize || "standard"),
      collapsed: Boolean(options.collapsed),
      pinned: Boolean(options.pinned),
      metric: asArray(definition.metrics).includes(options.metric) ? options.metric : cleanString(options.metric || definition.defaultMetric || "Open Items"),
      visualization: normalizeCentralDashboardVisualization(options.visualization, definition),
      filter: cleanString(options.filter || definition.filter || "all"),
      dateRange: CENTRAL_DASHBOARD_DATE_RANGES.includes(options.dateRange) ? options.dateRange : "All Open",
      propertyScope: CENTRAL_DASHBOARD_SCOPE_OPTIONS.some(([key]) => key === options.propertyScope) ? options.propertyScope : "current",
      propertyName: cleanString(options.propertyName),
      portfolioScope: CENTRAL_DASHBOARD_PORTFOLIO_SCOPE_OPTIONS.some(([key]) => key === options.portfolioScope) ? options.portfolioScope : "assigned",
      workflowFilter: cleanString(options.workflowFilter || definition.filter || "all"),
      agingFilter: CENTRAL_DASHBOARD_AGING_FILTERS.includes(options.agingFilter) ? options.agingFilter : "All Ages",
      sortOrder: CENTRAL_DASHBOARD_SORT_OPTIONS.includes(options.sortOrder) ? options.sortOrder : "Priority",
      updatedAt: cleanString(options.updatedAt || options.updated_at) || new Date().toISOString()
    };
  }

  function normalizeCentralDashboardWidgetInstance(input = {}, index = 0) {
    const raw = asObject(input);
    const definition = getCentralDashboardWidgetDefinition(raw.widgetKey || raw.widget_key || raw.key);
    if (!definition) return null;
    return buildCentralDashboardWidgetInstance(definition.key, index, raw);
  }

  function buildCentralDashboardDefaultPreferences(userKey = centralDashboardUserKey()) {
    const now = new Date().toISOString();
    return {
      schemaVersion: 1,
      userKey,
      viewName: "Central Services Default",
      widgets: CENTRAL_DASHBOARD_CORE_WIDGETS.map((widgetKey, index) => buildCentralDashboardWidgetInstance(widgetKey, index, {
        instanceId: `cs_default_${widgetKey}_${index + 1}`,
        position: index,
        size: getCentralDashboardWidgetDefinition(widgetKey)?.defaultSize || (index < 3 ? "expanded" : "standard")
      })),
      libraryOpen: false,
      savedAt: "",
      restoredAt: "",
      updatedAt: now
    };
  }

  function normalizeCentralDashboardPreferences(input = {}, userKey = centralDashboardUserKey()) {
    const raw = asObject(input);
    const defaults = buildCentralDashboardDefaultPreferences(userKey);
    const widgets = asArray(raw.widgets)
      .map(normalizeCentralDashboardWidgetInstance)
      .filter(Boolean)
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return (Number(a.position) || 0) - (Number(b.position) || 0);
      })
      .map((widget, index) => ({ ...widget, position: index }));
    return {
      ...defaults,
      ...raw,
      schemaVersion: 1,
      userKey: cleanString(raw.userKey || raw.user_key || userKey),
      viewName: cleanString(raw.viewName || raw.view_name || defaults.viewName),
      widgets: widgets.length ? widgets : defaults.widgets,
      libraryOpen: Boolean(raw.libraryOpen),
      savedAt: cleanString(raw.savedAt || raw.saved_at),
      restoredAt: cleanString(raw.restoredAt || raw.restored_at),
      updatedAt: cleanString(raw.updatedAt || raw.updated_at) || defaults.updatedAt
    };
  }

  function normalizeCentralDashboardPreferencesByUser(input = {}) {
    const raw = asObject(input);
    return Object.fromEntries(Object.entries(raw).map(([key, value]) => {
      const userKey = cleanString(key) || centralDashboardUserKey();
      return [userKey, normalizeCentralDashboardPreferences(value, userKey)];
    }));
  }

  function defaultUi() {
    return {
      module: "overview",
      propertyId: "all",
      monthIdx: null,
      year: new Date().getFullYear(),
      search: "",
      workflowFilter: "all",
      selectedRenewalId: "",
      selectedMoveOutId: "",
      selectedTaskId: "",
      selectedInspectionId: "",
      selectedMorfId: "",
      selectedVendorId: "",
      selectedDisputeId: "",
      selectedChargebackId: "",
      selectedComplianceRuleId: "",
      dashboardConfigId: "",
      inspectionStartProperty: "",
      inspectorSearch: ""
    };
  }

  function defaultState() {
    return {
      schemaVersion: 5,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ui: defaultUi(),
      renewals: [],
      moveOutCases: [],
      inspections: [],
      morfRecords: [],
      tasks: [],
      purchaseOrders: [],
      collections: [],
      evictions: [],
      invoices: [],
      vendorProfiles: [],
      vendorInfractions: [],
      residentDisputes: [],
      inspectionSyncQueue: [],
      notifications: [],
      auditTrail: [],
      importHistory: [],
      accountingContacts: [],
      potentialMoveOutUpdates: [],
      dashboardPreferencesByUser: {},
      inspectionTemplates: defaultInspectionTemplates(),
      roomLibrary: DEFAULT_ROOM_LIBRARY,
      componentLibrary: DEFAULT_COMPONENT_LIBRARY,
      commonAreaTypes: COMMON_AREA_TYPES,
      chargebackCatalog: defaultChargebackCatalog(),
      vendorSkillLibrary: DEFAULT_VENDOR_SKILLS,
      stateComplianceRules: [],
      workflowSettings: defaultWorkflowSettings()
    };
  }

  function normalizeState(input) {
    const base = defaultState();
    const source = asObject(input);
    const normalized = {
      ...base,
      ...source,
      schemaVersion: 5,
      ui: {
        ...base.ui,
        ...asObject(source.ui)
      }
    };
    normalized.ui.module = MODULES.some(([key]) => key === normalized.ui.module) ? normalized.ui.module : "overview";
    normalized.ui.propertyId = cleanString(normalized.ui.propertyId) || "all";
    const storedMonthIdx = source.ui?.monthIdx;
    normalized.ui.monthIdx = storedMonthIdx === null || storedMonthIdx === undefined || storedMonthIdx === ""
      ? null
      : Number.isInteger(Number(storedMonthIdx))
        ? Math.max(0, Math.min(11, Number(storedMonthIdx)))
        : null;
    normalized.ui.year = Number.isFinite(Number(normalized.ui.year)) ? Number(normalized.ui.year) : new Date().getFullYear();
    normalized.ui.search = cleanString(normalized.ui.search);
    EMPTY_ARRAY_KEYS.forEach(key => {
      normalized[key] = asArray(source[key]).filter(item => item && typeof item === "object").map(item => ({ ...item }));
    });
    normalized.moveOutCases = normalized.moveOutCases.map(normalizeMoveOutCaseRecord).filter(item => item.id && item.propertyName);
    normalized.inspections = normalized.inspections.map(normalizeInspectionRecord);
    normalized.morfRecords = normalized.morfRecords.map(normalizeMorfRecord);
    normalized.vendorProfiles = normalized.vendorProfiles.map(normalizeVendorProfile).filter(item => item.id);
    normalized.residentDisputes = normalized.residentDisputes.map(normalizeDisputeRecord);
    normalized.dashboardPreferencesByUser = normalizeCentralDashboardPreferencesByUser(source.dashboardPreferencesByUser);
    normalized.inspectionTemplates = mergeConfigById(defaultInspectionTemplates(), source.inspectionTemplates, normalizeInspectionTemplate);
    normalized.chargebackCatalog = mergeConfigById(defaultChargebackCatalog(), source.chargebackCatalog, normalizeChargebackCatalogItem);
    normalized.roomLibrary = uniqueStrings([...DEFAULT_ROOM_LIBRARY, ...asArray(source.roomLibrary)]);
    normalized.componentLibrary = uniqueStrings([...DEFAULT_COMPONENT_LIBRARY, ...asArray(source.componentLibrary)]);
    normalized.commonAreaTypes = uniqueStrings([...COMMON_AREA_TYPES, ...asArray(source.commonAreaTypes)]);
    normalized.vendorSkillLibrary = uniqueStrings([...DEFAULT_VENDOR_SKILLS, ...asArray(source.vendorSkillLibrary)]);
    normalized.stateComplianceRules = asArray(source.stateComplianceRules).map(normalizeStateComplianceRule).filter(rule => rule.id);
    normalized.workflowSettings = {
      ...defaultWorkflowSettings(),
      ...asObject(source.workflowSettings)
    };
    normalized.workflowSettings.companyHolidays = uniqueStrings(asArray(normalized.workflowSettings.companyHolidays).map(normalizeDate).filter(Boolean));
    normalized.workflowSettings.inspectionEligibleRoleSignals = uniqueStrings(asArray(normalized.workflowSettings.inspectionEligibleRoleSignals).length
      ? normalized.workflowSettings.inspectionEligibleRoleSignals
      : defaultWorkflowSettings().inspectionEligibleRoleSignals);
    normalized.workflowSettings.morfInternalBusinessDays = Math.max(1, whole(normalized.workflowSettings.morfInternalBusinessDays || 5));
    normalized.workflowSettings.defaultMarketZipMultiplier = Number(normalized.workflowSettings.defaultMarketZipMultiplier) > 0
      ? Number(normalized.workflowSettings.defaultMarketZipMultiplier)
      : 1;
    normalized.workflowSettings.lockReviewBusinessDays = Math.max(0, whole(normalized.workflowSettings.lockReviewBusinessDays || 30));
    normalized.workflowSettings.mailingBufferBusinessDays = Math.max(0, whole(normalized.workflowSettings.mailingBufferBusinessDays || 7));
    normalized.workflowSettings.residentCopySuppressesAmounts = normalized.workflowSettings.residentCopySuppressesAmounts !== false;
    return normalized;
  }

  function loadState() {
    removeLegacyStorage();
    const state = normalizeState(safeJsonParse(storageGet(STORAGE_KEY), {}));
    const renewalSyncChanged = syncAtlasRenewalDataIntoCentralServices(state);
    const lifecycleChanged = refreshLifecycleDerivedState(state);
    if (renewalSyncChanged || lifecycleChanged) {
      storageSet(STORAGE_KEY, JSON.stringify({ ...state, updatedAt: new Date().toISOString() }));
    }
    return state;
  }

  function saveState(state) {
    const next = normalizeState({
      ...state,
      updatedAt: new Date().toISOString()
    });
    return storageSet(STORAGE_KEY, JSON.stringify(next));
  }

  function renderActiveTab() {
    if (typeof renderTab === "function") {
      renderTab();
    } else {
      const panel = document.getElementById("tab-panel-15");
      if (panel) panel.innerHTML = window.renderCentralServicesTab();
    }
  }

  function addAudit(state, label, details = {}) {
    state.auditTrail.unshift({
      id: makeId("audit", [Date.now(), label, JSON.stringify(details)]),
      at: new Date().toISOString(),
      label,
      details
    });
    state.auditTrail = state.auditTrail.slice(0, 250);
  }

  function selectedMonthIdx(state) {
    const storedMonthIdx = state?.ui?.monthIdx;
    if (storedMonthIdx !== null && storedMonthIdx !== undefined && storedMonthIdx !== "" && Number.isInteger(Number(storedMonthIdx))) {
      return Math.max(0, Math.min(11, Number(storedMonthIdx)));
    }
    const visibleMonthControl = document.getElementById("workspace-current-month") || document.getElementById("atlas-topbar-period");
    if (visibleMonthControl && Number.isInteger(Number(visibleMonthControl.value))) {
      return Math.max(0, Math.min(11, Number(visibleMonthControl.value)));
    }
    if (typeof getSelectedDashboardMonthIndex === "function") return getSelectedDashboardMonthIndex();
    return new Date().getMonth();
  }

  function selectedYear(state) {
    return Number.isFinite(Number(state?.ui?.year)) ? Number(state.ui.year) : new Date().getFullYear();
  }

  function localPeriodKey(monthIdx, year) {
    if (typeof buildPeriodKey === "function") return buildPeriodKey(monthIdx, year);
    return `${year}-${String(monthIdx + 1).padStart(2, "0")}`;
  }

  function getAtlasPropertyNames() {
    const names = [];
    const seen = new Set();
    const add = value => {
      const name = cleanString(value);
      if (!name || seen.has(name)) return;
      seen.add(name);
      names.push(name);
    };
    try {
      if (typeof getAllCommunityNames === "function") getAllCommunityNames().forEach(add);
    } catch {
      // Fall back below.
    }
    try {
      if (typeof savedData !== "undefined") Object.keys(savedData || {}).forEach(add);
    } catch {
      // Fall back below.
    }
    try {
      if (Array.isArray(PROPERTIES)) PROPERTIES.forEach(property => add(property.name));
    } catch {
      // No static property list is available yet.
    }
    return names;
  }

  function getCommunityRecord(name) {
    try {
      const raw = typeof savedData !== "undefined" ? savedData?.[name] : null;
      if (typeof normalizeSavedCommunityRecord === "function") return normalizeSavedCommunityRecord(name, raw || {});
      return asObject(raw);
    } catch {
      return {};
    }
  }

  function getPropertyUnits(name, record) {
    try {
      const prop = typeof getPropertyByName === "function" ? getPropertyByName(name) : { name };
      if (typeof getResolvedTotalUnitsForRecord === "function") return whole(getResolvedTotalUnitsForRecord(name, record, { prop }));
      if (typeof getTotalUnitsFor === "function") return whole(getTotalUnitsFor(prop, record?.customUnits));
      return whole(record?.customUnits || prop?.units);
    } catch {
      return whole(record?.customUnits);
    }
  }

  function getPortfolioProperties() {
    return getAtlasPropertyNames().map(name => {
      const record = getCommunityRecord(name);
      return {
        id: name,
        name,
        record,
        units: getPropertyUnits(name, record),
        region: cleanString(record.communityRegionalGrouping || record.communityMarket),
        market: cleanString(record.communityMarket),
        propertyType: cleanString(record.communityPropertyType),
        active: typeof isCommunityStatusActive === "function" ? isCommunityStatusActive(record) : true
      };
    });
  }

  function getScopedProperties(state) {
    const properties = getPortfolioProperties();
    if (state.ui.propertyId === "all") return properties;
    return properties.filter(property => property.name === state.ui.propertyId);
  }

  function getRenewalEntry(property, monthIdx, year) {
    try {
      if (typeof getRenewalMonthEntryForRecord === "function") return getRenewalMonthEntryForRecord(property.record, monthIdx, year) || {};
    } catch {
      // Fall through to the normalized record data.
    }
    return asObject(property.record?.monthlyData?.[monthIdx]);
  }

  function renewalSummaryFromEntry(entry) {
    try {
      if (typeof getRenewalSummaryForMonth === "function") {
        const summary = getRenewalSummaryForMonth(entry) || {};
        return {
          expirations: whole(summary.expirations),
          signed: whole(summary.signed),
          ntv: whole(summary.ntv),
          transfers: whole(summary.transfers),
          undecided: summary.undecided === null ? whole(entry.renewalUndecided) : whole(summary.undecided),
          earlyTermination: whole(summary.earlyTermination),
          retentionRate: summary.retentionRate,
          decidedRetentionRate: summary.decidedRetentionRate
        };
      }
    } catch {
      // Fall through to direct monthly fields.
    }
    const expirations = whole(entry.renewalExpirations);
    const signed = whole(entry.renewalSigned);
    const ntv = whole(entry.renewalNTV);
    const transfers = whole(entry.renewalTransfers);
    const earlyTermination = whole(entry.renewalEarlyTermination);
    return {
      expirations,
      signed,
      ntv,
      transfers,
      undecided: whole(entry.renewalUndecided || Math.max(expirations - signed - ntv - transfers - earlyTermination, 0)),
      earlyTermination,
      retentionRate: expirations > 0 ? signed / expirations * 100 : null,
      decidedRetentionRate: signed + ntv > 0 ? signed / (signed + ntv) * 100 : null
    };
  }

  function rowIsInScope(row, state) {
    const periodKey = localPeriodKey(selectedMonthIdx(state), selectedYear(state));
    const propertyOk = state.ui.propertyId === "all" || row.propertyName === state.ui.propertyId;
    return propertyOk && row.periodKey === periodKey;
  }

  function summarizeRenewalRows(rows) {
    const summary = { expirations: rows.length, signed: 0, ntv: 0, transfers: 0, undecided: 0, earlyTermination: 0 };
    rows.forEach(row => {
      const status = cleanString(row.status).toLowerCase();
      if (status.includes("signed") || status.includes("renewed")) summary.signed += 1;
      else if (status.includes("ntv") || status.includes("notice")) summary.ntv += 1;
      else if (status.includes("transfer")) summary.transfers += 1;
      else summary.undecided += 1;
    });
    summary.retentionRate = summary.expirations > 0 ? summary.signed / summary.expirations * 100 : null;
    summary.decidedRetentionRate = summary.signed + summary.ntv > 0 ? summary.signed / (summary.signed + summary.ntv) * 100 : null;
    return summary;
  }

  function getDetailedRowsForProperty(state, propertyName) {
    const periodKey = localPeriodKey(selectedMonthIdx(state), selectedYear(state));
    return state.renewals.filter(row => row.propertyName === propertyName && row.periodKey === periodKey);
  }

  function getPropertyMonthSummaries(state) {
    const monthIdx = selectedMonthIdx(state);
    const year = selectedYear(state);
    return getScopedProperties(state).map(property => {
      const entry = getRenewalEntry(property, monthIdx, year);
      const detailedRows = getDetailedRowsForProperty(state, property.name);
      const summary = detailedRows.length ? summarizeRenewalRows(detailedRows) : renewalSummaryFromEntry(entry);
      const hasSummaryData = Object.values(summary).some(value => Number(value) > 0);
      let sourceLabel = hasSummaryData ? "ATLAS monthly summary" : "No renewal data loaded";
      try {
        const periodKey = localPeriodKey(monthIdx, year);
        const stamp = typeof getPeriodImportStamp === "function" ? getPeriodImportStamp(property.record, "renewals", periodKey) : {};
        if (stamp?.sourceFileName) sourceLabel = stamp.sourceFileName;
      } catch {
        // Keep the generic source label.
      }
      if (detailedRows.length) sourceLabel = "Central Services import";
      return {
        propertyId: property.name,
        propertyName: property.name,
        region: property.region,
        market: property.market,
        units: property.units,
        active: property.active,
        sourceLabel,
        hasDetailed: detailedRows.length > 0,
        hasSummaryData,
        expirations: whole(summary.expirations),
        signed: whole(summary.signed),
        ntv: whole(summary.ntv),
        transfers: whole(summary.transfers),
        undecided: whole(summary.undecided),
        earlyTermination: whole(summary.earlyTermination),
        retentionRate: summary.retentionRate,
        moveOuts: whole(entry.moveOuts),
        moveIns: whole(entry.moveIns)
      };
    });
  }

  function getScopedRenewals(state) {
    const rows = state.renewals.filter(row => rowIsInScope(row, state));
    const query = normalizeKey(state.ui.search);
    if (!query) return rows;
    return rows.filter(row => normalizeKey([
      row.residentName,
      row.propertyName,
      row.unit,
      row.status,
      row.owner,
      row.notes
    ].join(" ")).includes(query));
  }

  function getScopedMoveOuts(state) {
    const periodKey = localPeriodKey(selectedMonthIdx(state), selectedYear(state));
    const scopedPropertyNames = new Set(getScopedProperties(state).map(property => property.name));
    const query = normalizeKey(state.ui.search);
    return state.moveOutCases.filter(item => {
      const propertyOk = state.ui.propertyId === "all" ? scopedPropertyNames.has(item.propertyName) : item.propertyName === state.ui.propertyId;
      const periodOk = !item.periodKey || item.periodKey === periodKey;
      return propertyOk && periodOk && moveOutCaseMatchesSearch(item, query);
    });
  }

  function getScopedTasks(state) {
    const scopedPropertyNames = new Set(getScopedProperties(state).map(property => property.name));
    const query = normalizeKey(state.ui.search);
    return state.tasks
      .filter(task => state.ui.propertyId === "all" ? scopedPropertyNames.has(task.propertyName) : task.propertyName === state.ui.propertyId)
      .filter(task => !query || normalizeKey([task.title, task.propertyName, task.residentName, task.owner, task.type].join(" ")).includes(query));
  }

  function currentActor() {
    try {
      const user = window.atlasCurrentUser || window.currentUser || window.activeUser || {};
      const name = cleanString(user.displayName || user.name || user.fullName || user.email || window.currentUserName);
      const id = cleanString(user.userId || user.employeeId || user.id || user.email || window.currentUserId);
      return {
        name: name || "Central Services",
        userId: id || "central-services"
      };
    } catch {
      return { name: "Central Services", userId: "central-services" };
    }
  }

  function currentUserCanManageGlobalDashboardDefault() {
    try {
      const profile = typeof getAtlasAccessProfile === "function" ? getAtlasAccessProfile() : {};
      const role = normalizeKey(profile?.role || profile?.roleName || profile?.accessRole || window.atlasCurrentUser?.role);
      return ["admin", "administrator", "executive", "vp", "owner"].some(value => role.includes(value));
    } catch {
      return false;
    }
  }

  function dateValue(dateIso) {
    const normalized = normalizeDate(dateIso);
    return normalized ? new Date(`${normalized}T00:00:00`).getTime() : null;
  }

  function daysBetween(startIso, endIso) {
    const start = dateValue(startIso);
    const end = dateValue(endIso);
    if (start === null || end === null) return null;
    return Math.ceil((end - start) / 86400000);
  }

  function getActualPossessionDate(record = {}) {
    return normalizeDate(record.actualPossessionReturnedDate || record.possessionReturnedDate);
  }

  function isCaseArchivedOrClosed(caseRecord = {}) {
    return ["Sent to Accounting", "Archived / Open", "MORF Closed", "Closed", "Final / Locked"].includes(caseRecord.workflowStatus) || Boolean(caseRecord.archivedAt);
  }

  function isInspectionApprovedStatus(status) {
    return INSPECTION_APPROVED_STATUSES.includes(cleanString(status));
  }

  function getMoveOutInspectionForCase(state, caseRecord = {}) {
    return state.inspections.find(inspection => inspection.relatedMoveOutId === caseRecord.id && inspection.templateName === "Move-Out Inspection") || null;
  }

  function caseInspectionIsApproved(state, caseRecord = {}) {
    const inspection = getMoveOutInspectionForCase(state, caseRecord);
    return isInspectionApprovedStatus(inspection?.status) || isInspectionApprovedStatus(caseRecord.inspectionApprovalStatus);
  }

  function isCompanyHoliday(state, dateIso) {
    const normalized = normalizeDate(dateIso);
    if (!normalized) return false;
    return new Set(asArray(state?.workflowSettings?.companyHolidays).map(normalizeDate).filter(Boolean)).has(normalized);
  }

  function isBusinessDate(state, dateIso) {
    const normalized = normalizeDate(dateIso);
    if (!normalized) return false;
    const day = new Date(`${normalized}T00:00:00`).getDay();
    return day !== 0 && day !== 6 && !isCompanyHoliday(state, normalized);
  }

  function addBusinessDaysWithSettings(state, dateIso, days) {
    const normalized = normalizeDate(dateIso);
    if (!normalized) return "";
    const date = new Date(`${normalized}T00:00:00`);
    let remaining = Math.max(0, whole(days));
    while (remaining > 0) {
      date.setDate(date.getDate() + 1);
      const next = date.toISOString().slice(0, 10);
      if (isBusinessDate(state, next)) remaining -= 1;
    }
    return date.toISOString().slice(0, 10);
  }

  function calculateDefaultInspectionDate(state, caseRecord = {}) {
    const scheduledMoveOutDate = normalizeDate(caseRecord.scheduledMoveOutDate);
    return scheduledMoveOutDate ? addBusinessDaysWithSettings(state, scheduledMoveOutDate, 1) : "";
  }

  function dateIsOnOrBefore(dateIso, comparisonIso) {
    const date = dateValue(dateIso);
    const comparison = dateValue(comparisonIso);
    return date !== null && comparison !== null && date <= comparison;
  }

  function stampLifecycle(caseRecord, key, at = new Date().toISOString()) {
    if (!key) return;
    caseRecord.lifecycleTimestamps = asObject(caseRecord.lifecycleTimestamps);
    caseRecord.lifecycleTimestamps[key] = caseRecord.lifecycleTimestamps[key] || at;
  }

  function lifecycleTimestampKey(status) {
    const map = {
      "On Notice": "noticeReceived",
      "Upcoming Move Out": "moveOutScheduled",
      "Hold Over / Past Due Move Out": "holdoverStarted",
      "Inspection Hold - Possession Not Returned": "inspectionHoldStarted",
      "Possession Confirmed": "actualPossessionConfirmed",
      "Move-Out Inspection": "inspectionScheduled",
      "Inspection Approval": "inspectionCompleted",
      "MORF Ready": "morfReady",
      "MORF In Progress": "morfProcessingStarted",
      "MORF Finalized": "morfFinalized",
      "Sent to Accounting": "sentToAccounting",
      "Archived / Open": "archivedOpen",
      "MORF Closed": "morfClosed"
    };
    return map[status] || "";
  }

  function setCaseWorkflowStatus(caseRecord, status, label, details = {}) {
    const newStatus = normalizeLifecycleStatus(status);
    const previousStatus = caseRecord.workflowStatus || "";
    caseRecord.workflowStatus = newStatus;
    caseRecord.lifecycleStatus = newStatus;
    stampLifecycle(caseRecord, lifecycleTimestampKey(newStatus));
    if (label || previousStatus !== newStatus) {
      pushCaseActivity(caseRecord, label || `Lifecycle moved to ${newStatus}.`, {
        ...details,
        previousStatus,
        newStatus
      });
    }
  }

  function isHoldOverCase(caseRecord = {}) {
    return ["Hold Over / Past Due Move Out", "Inspection Hold - Possession Not Returned"].includes(caseRecord.workflowStatus) ||
      caseRecord.inspectionStatus === "HOLD - POSSESSION NOT RETURNED";
  }

  function moveOutCaseMatchesSearch(caseRecord, query) {
    if (!query) return true;
    return normalizeKey([
      caseRecord.residentName,
      caseRecord.residentId,
      caseRecord.leaseId,
      caseRecord.propertyName,
      caseRecord.unit,
      caseRecord.workflowStatus,
      caseRecord.inspectionStatus,
      caseRecord.inspectionApprovalStatus,
      caseRecord.morfSodaStatus,
      caseRecord.accountingStatus,
      caseRecord.owner,
      caseRecord.assignedRegional,
      caseRecord.email,
      caseRecord.phone,
      caseRecord.notes
    ].join(" ")).includes(query);
  }

  function shouldMoveToHoldover(state, caseRecord = {}) {
    if (getActualPossessionDate(caseRecord) || isCaseArchivedOrClosed(caseRecord)) return false;
    const scheduledInspectionDate = normalizeDate(caseRecord.inspectionDate) || calculateDefaultInspectionDate(state, caseRecord);
    return Boolean(scheduledInspectionDate && dateIsOnOrBefore(scheduledInspectionDate, TODAY_ISO));
  }

  function refreshLifecycleDerivedState(state) {
    let changed = false;
    state.moveOutCases.forEach(caseRecord => {
      const defaultInspectionDate = calculateDefaultInspectionDate(state, caseRecord);
      if (!caseRecord.inspectionDate && defaultInspectionDate && !getActualPossessionDate(caseRecord)) {
        caseRecord.inspectionDate = defaultInspectionDate;
        caseRecord.inspectionStatus = caseRecord.inspectionStatus === "Not Scheduled" ? "Inspection Scheduled" : caseRecord.inspectionStatus;
        stampLifecycle(caseRecord, "inspectionScheduled");
        changed = true;
      }
      if (shouldMoveToHoldover(state, caseRecord) && !isHoldOverCase(caseRecord)) {
        caseRecord.possessionStatus = "Not Returned";
        caseRecord.inspectionStatus = "HOLD - POSSESSION NOT RETURNED";
        setCaseWorkflowStatus(caseRecord, "Hold Over / Past Due Move Out", "Possession was not confirmed by the scheduled inspection date; record moved to Hold Over / Past Due Move Outs.");
        changed = true;
      }
    });
    return changed;
  }

  function addBusinessDays(dateIso, days) {
    const normalized = normalizeDate(dateIso);
    if (!normalized) return "";
    const date = new Date(`${normalized}T00:00:00`);
    let remaining = Math.max(0, whole(days));
    while (remaining > 0) {
      date.setDate(date.getDate() + 1);
      const day = date.getDay();
      if (day !== 0 && day !== 6) remaining -= 1;
    }
    return date.toISOString().slice(0, 10);
  }

  function extractStateFromAddress(address) {
    const match = cleanString(address).match(/,\s*([A-Z]{2})\s+\d{5}(?:-\d{4})?\b/i);
    return match ? match[1].toUpperCase() : "";
  }

  function getPropertyStateCode(propertyName) {
    const record = getCommunityRecord(propertyName);
    const direct = cleanString(
      record.communityState ||
      record.propertyState ||
      record.state ||
      record.addressState ||
      record?.address?.state
    ).toUpperCase();
    if (direct.length === 2) return direct;
    return extractStateFromAddress(record.communityAddress || record.address || record.propertyAddress);
  }

  function getPropertyZipCode(propertyName) {
    const record = getCommunityRecord(propertyName);
    const direct = cleanString(record.communityZip || record.propertyZip || record.zip || record.zipCode || record?.address?.zip);
    if (direct) return direct;
    const match = cleanString(record.communityAddress || record.address || record.propertyAddress).match(/\b\d{5}(?:-\d{4})?\b/);
    return match ? match[0] : "";
  }

  function getStateComplianceRuleForProperty(state, propertyName) {
    const stateCode = getPropertyStateCode(propertyName);
    if (!stateCode) return null;
    return state.stateComplianceRules.find(rule => rule.active !== false && rule.state === stateCode) || null;
  }

  function calculateLegalDeadlineForCase(state, caseRecord) {
    const rule = getStateComplianceRuleForProperty(state, caseRecord.propertyName);
    const possessionDate = getActualPossessionDate(caseRecord);
    if (!rule || !possessionDate || !rule.depositAccountingDeadlineDays) return "";
    const dayRule = normalizeKey(rule.dayRule);
    return dayRule.includes("business")
      ? addBusinessDaysWithSettings(state, possessionDate, rule.depositAccountingDeadlineDays)
      : addDays(possessionDate, rule.depositAccountingDeadlineDays);
  }

  function calculateInternalMorfDueDate(state, caseRecord) {
    const possessionDate = getActualPossessionDate(caseRecord);
    if (!possessionDate) return "";
    return addBusinessDaysWithSettings(state, possessionDate, state.workflowSettings.morfInternalBusinessDays || 5);
  }

  function getScopedInspections(state) {
    const scopedPropertyNames = new Set(getScopedProperties(state).map(property => property.name));
    const query = normalizeKey(state.ui.search);
    return state.inspections
      .filter(item => state.ui.propertyId === "all" ? scopedPropertyNames.has(item.propertyName) : item.propertyName === state.ui.propertyId)
      .filter(item => !query || normalizeKey([
        item.templateName,
        item.propertyName,
        item.unit,
        item.locationName,
        item.residentName,
        item.inspectorName,
        item.status
      ].join(" ")).includes(query));
  }

  function getScopedMorfs(state) {
    const scopedPropertyNames = new Set(getScopedProperties(state).map(property => property.name));
    const query = normalizeKey(state.ui.search);
    return state.morfRecords
      .filter(item => state.ui.propertyId === "all" ? scopedPropertyNames.has(item.propertyName) : item.propertyName === state.ui.propertyId)
      .filter(item => morfMatchesSearch(item, query));
  }

  function morfMatchesSearch(morf, query) {
    if (!query) return true;
    const handoff = asObject(morf.accountingHandoff);
    return normalizeKey([
      morf.id,
      morf.inspectionId,
      morf.residentName,
      morf.propertyName,
      morf.unit,
      morf.processor,
      morf.status,
      morf.archiveStatus,
      morf.accountingHandoffStatus,
      morf.moveOutDate,
      morf.possessionReturnedDate,
      handoff.sentAt,
      handoff.refundAmount,
      handoff.balanceDue,
      morf.disputeStatus
    ].join(" ")).includes(query);
  }

  function getActiveScopedMorfs(state) {
    return getScopedMorfs(state).filter(morf => {
      if (morf.archivedAt || morf.archiveStatus === "MORF Closed") return false;
      return MORF_ACTIVE_STATUSES.includes(morf.status);
    });
  }

  function getScopedArchivedMorfs(state) {
    return getScopedMorfs(state).filter(morf => {
      return Boolean(morf.archivedAt) ||
        morf.status === "Sent to Accounting" ||
        morf.status === "Archived / Open" ||
        ARCHIVE_STATUS_OPTIONS.includes(morf.archiveStatus);
    });
  }

  function getScopedVendors(state) {
    const query = normalizeKey(state.ui.search);
    return state.vendorProfiles.filter(vendor => {
      const servedProperties = asArray(vendor.propertiesServed);
      const propertyOk = state.ui.propertyId === "all" || !servedProperties.length || servedProperties.includes(state.ui.propertyId);
      const queryOk = !query || normalizeKey([
        vendor.name,
        vendor.entrataVendorCode,
        vendor.complianceStatus,
        asArray(vendor.skills).join(" "),
        asArray(vendor.marketsServed).join(" "),
        asArray(vendor.serviceAreas).join(" ")
      ].join(" ")).includes(query);
      return propertyOk && queryOk;
    });
  }

  function getScopedDisputes(state) {
    const scopedPropertyNames = new Set(getScopedProperties(state).map(property => property.name));
    const query = normalizeKey(state.ui.search);
    return state.residentDisputes
      .filter(item => state.ui.propertyId === "all" ? scopedPropertyNames.has(item.propertyName) : item.propertyName === state.ui.propertyId)
      .filter(item => !query || normalizeKey([item.id, item.morfId, item.moveOutCaseId, item.residentName, item.propertyName, item.unit, item.status, item.reason, item.statementVersion].join(" ")).includes(query));
  }

  function findingHasResidentCharge(finding) {
    return cleanString(finding.residentResponsibility) === "Recommended" && cleanString(finding.chargebackId);
  }

  function findingHasPhoto(finding) {
    return asArray(finding.photos).length > 0;
  }

  function findingHasPhotoOverride(finding) {
    return Boolean(finding.photoRequirementOverride?.reason);
  }

  function getInspectionMissingPhotoChargeCount(inspection) {
    return asArray(inspection.findings).filter(finding => findingHasResidentCharge(finding) && !findingHasPhoto(finding) && !findingHasPhotoOverride(finding)).length;
  }

  function getApprovedInspectionChargesForCase(state, caseRecord) {
    return state.inspections
      .filter(inspection => inspection.relatedMoveOutId === caseRecord.id && isInspectionApprovedStatus(inspection.status))
      .flatMap(inspection => asArray(inspection.findings)
        .filter(findingHasResidentCharge)
        .map(finding => ({ inspection, finding })));
  }

  function getMoveOutWorkflowBuckets(state) {
    const buckets = {
      upcoming: [],
      holdover: [],
      inspections: [],
      approval: [],
      morfReady: [],
      morfInProgress: [],
      waiting: [],
      risk: [],
      sent: [],
      archived: []
    };
    getScopedMoveOuts(state).forEach(caseRecord => {
      const morf = getMorfForCase(state, caseRecord.id);
      const actualPossession = getActualPossessionDate(caseRecord);
      const inspection = getMoveOutInspectionForCase(state, caseRecord);
      const morfStatus = cleanString(morf?.status || caseRecord.morfSodaStatus);
      const legalRemaining = daysUntil(morf?.legalDeadline || calculateLegalDeadlineForCase(state, caseRecord));
      const sentToAccounting = caseRecord.accountingStatus === "Sent to Accounting" || morfStatus === "Sent to Accounting" || morf?.accountingHandoffStatus === "Sent to Accounting";
      const archived = Boolean(morf?.archivedAt) || ["Archived / Open", "MORF Closed"].includes(caseRecord.workflowStatus) || ["Sent to Accounting / Open", "MORF Closed"].includes(morf?.archiveStatus);

      if (sentToAccounting) {
        buckets.sent.push(caseRecord);
      }
      if (archived) {
        buckets.archived.push(caseRecord);
        return;
      }
      if (isHoldOverCase(caseRecord)) {
        buckets.holdover.push(caseRecord);
        return;
      }
      if (!actualPossession) {
        buckets.upcoming.push(caseRecord);
        return;
      }
      if (["Waiting on Site", "Waiting on Utilities", "Waiting on Documentation", "Waiting on Information"].includes(morfStatus)) {
        buckets.waiting.push(caseRecord);
      }
      if (legalRemaining !== null && legalRemaining <= 2) {
        buckets.risk.push(caseRecord);
      }
      if (!inspection || ["Draft", "HOLD - POSSESSION NOT RETURNED"].includes(inspection.status) || ["Move-Out Inspection", "Possession Confirmed", "Inspection Scheduled", "Inspection Pending"].includes(caseRecord.workflowStatus)) {
        buckets.inspections.push(caseRecord);
        return;
      }
      if (!caseInspectionIsApproved(state, caseRecord)) {
        buckets.approval.push(caseRecord);
        return;
      }
      if (["MORF In Progress", "Ready for Final Review", "MORF Finalized", "Approved"].includes(morfStatus)) {
        buckets.morfInProgress.push(caseRecord);
        return;
      }
      buckets.morfReady.push(caseRecord);
    });
    return buckets;
  }

  function getKpis(state, centralEmployees) {
    const summaries = getPropertyMonthSummaries(state);
    const moveOutCases = getScopedMoveOuts(state);
    const tasks = getScopedTasks(state);
    const inspections = getScopedInspections(state);
    const morfs = getScopedMorfs(state);
    const activeMorfs = getActiveScopedMorfs(state);
    const archivedMorfs = getScopedArchivedMorfs(state);
    const disputes = getScopedDisputes(state);
    const openTasks = tasks.filter(task => task.status !== "Completed");
    const overdueTasks = openTasks.filter(task => {
      const delta = daysUntil(task.dueDate);
      return delta !== null && delta < 0;
    });
    const morfsDue = activeMorfs.filter(morf => !["MORF Finalized", "Approved"].includes(morf.status));
    const morfsOverdue = morfsDue.filter(morf => {
      const delta = daysUntil(morf.internalDueDate);
      return delta !== null && delta < 0;
    });
    const buckets = getMoveOutWorkflowBuckets(state);
    const missingDocumentation = inspections.reduce((sum, inspection) => sum + getInspectionMissingPhotoChargeCount(inspection), 0);
    return {
      propertyCount: getScopedProperties(state).length,
      rosterCount: centralEmployees.length,
      expirations: summaries.reduce((sum, row) => sum + row.expirations, 0),
      signed: summaries.reduce((sum, row) => sum + row.signed, 0),
      ntv: summaries.reduce((sum, row) => sum + row.ntv, 0),
      undecided: summaries.reduce((sum, row) => sum + row.undecided, 0),
      transfers: summaries.reduce((sum, row) => sum + row.transfers, 0),
      moveOutsInMonth: summaries.reduce((sum, row) => sum + row.moveOuts, 0),
      moveOutCaseCount: moveOutCases.length,
      upcomingMoveOuts: buckets.upcoming.length,
      holdovers: buckets.holdover.length,
      moveOutInspections: buckets.inspections.length,
      inspectionApprovals: buckets.approval.length,
      morfsReady: buckets.morfReady.length,
      morfsInProgress: buckets.morfInProgress.length,
      waitingInfo: buckets.waiting.length,
      legalDeadlineRisk: buckets.risk.length,
      sentToAccounting: buckets.sent.length,
      archivedMorfs: archivedMorfs.length,
      mogAwaiting: moveOutCases.filter(item => ["MOG Sent", "Awaiting Signature"].includes(item.workflowStatus) || item.mogStatus === "Awaiting Signature").length,
      inspectionsInProgress: inspections.filter(item => ["Draft", "Submitted", "Awaiting Review", "Under Review", "Changes Requested"].includes(item.status)).length,
      inspectionsAwaitingApproval: inspections.filter(item => ["Submitted", "Awaiting Review", "Under Review"].includes(item.status)).length,
      morfsDue: morfsDue.length,
      morfsOverdue: morfsOverdue.length,
      disputesOpen: disputes.filter(item => !["Final / Locked", "Closed", "Dispute Closed", "MORF Closed"].includes(item.status)).length,
      missingDocumentation,
      photoOverrides: inspections.reduce((sum, inspection) => sum + asArray(inspection.findings).filter(findingHasPhotoOverride).length, 0),
      openTasks: openTasks.length,
      overdueTasks: overdueTasks.length
    };
  }

  function pickEmployeeValue(employee, keys) {
    for (const key of keys) {
      if (employee?.[key] !== undefined && cleanString(employee[key])) return cleanString(employee[key]);
    }
    return "";
  }

  function getEmployeeName(employee = {}) {
    const direct = pickEmployeeValue(employee, ["name", "fullName", "employeeName", "Employee Name", "Full Name"]);
    if (direct) return direct;
    const first = pickEmployeeValue(employee, ["firstName", "First Name"]);
    const last = pickEmployeeValue(employee, ["lastName", "Last Name"]);
    return cleanString(`${first} ${last}`);
  }

  function employeeIsActive(raw = {}, normalized = {}) {
    const status = cleanString(raw.status || raw.Status || raw.employmentStatus || raw.employment_status || normalized.status || "Active").toLowerCase();
    if (status.includes("terminated") || status.includes("inactive") || status.includes("archived")) return false;
    if (raw.archived || raw.deleted || raw.isDeleted) return false;
    if (normalizeDate(raw.terminationDate || raw["Termination Date"] || normalized.terminationDate)) return false;
    if (normalized.active === false) return false;
    return true;
  }

  function employeeCentralSignal(raw = {}, normalized = {}) {
    const departmentFields = [
      raw.department,
      raw.Department,
      raw.departmentName,
      raw.homeDepartment,
      raw.orgUnit,
      raw.organizationUnit,
      raw.businessUnit,
      raw.costCenter,
      raw.team,
      raw.division,
      normalized.department
    ];
    const directDepartment = departmentFields.map(cleanString).filter(Boolean).join(" ");
    if (CENTRAL_DEPARTMENT_PATTERNS.some(pattern => pattern.test(directDepartment))) return true;

    const fallbackFields = [
      raw.title,
      raw.role,
      raw["Job Title"],
      raw.position,
      raw.group,
      raw.location,
      normalized.title,
      normalized.source
    ].map(cleanString).filter(Boolean).join(" ");
    return !directDepartment && CENTRAL_DEPARTMENT_PATTERNS.some(pattern => pattern.test(fallbackFields));
  }

  function normalizeCentralEmployee(raw = {}, meta = {}) {
    const normalized = asObject(meta.normalized);
    const email = pickEmployeeValue(raw, ["email", "workEmail", "Work Email", "Email"]) || cleanString(normalized.email);
    const employeeNumber = pickEmployeeValue(raw, ["employeeNumber", "Employee Number", "employee_number"]) || cleanString(normalized.employeeNumber);
    const name = getEmployeeName(raw) || cleanString(normalized.name);
    const title = pickEmployeeValue(raw, ["title", "role", "Job Title", "position"]) || cleanString(normalized.title);
    const department = pickEmployeeValue(raw, [
      "department",
      "Department",
      "departmentName",
      "homeDepartment",
      "orgUnit",
      "organizationUnit",
      "businessUnit",
      "costCenter",
      "team",
      "division"
    ]);
    const key = employeeNumber
      ? `empnum:${employeeNumber}`
      : email
        ? `email:${email.toLowerCase()}`
        : `name:${normalizeKey(name)}:${normalizeKey(title)}`;
    return {
      employeeId: cleanString(normalized.employeeId || raw.employeeId || raw.id || key),
      peopleEmployeeId: cleanString(normalized.peopleEmployeeId || raw.peopleEmployeeId || raw.id),
      employeeNumber,
      email: email.toLowerCase(),
      name,
      title,
      department,
      status: pickEmployeeValue(raw, ["status", "Status", "employmentStatus", "employment_status"]) || cleanString(normalized.status || "Active"),
      source: cleanString(meta.source || normalized.source || "People roster"),
      homeProperty: pickEmployeeValue(raw, ["homeProperty", "assignedProperty", "propertyName", "communityName", "location", "workLocation", "Property", "Community"]) || cleanString(normalized.homeProperty || normalized.propertyName || normalized.communityName),
      region: pickEmployeeValue(raw, ["region", "regional", "market", "communityRegionalGrouping", "Region", "Market"]) || cleanString(normalized.region || normalized.market),
      portfolio: pickEmployeeValue(raw, ["portfolio", "ownershipGroup", "businessUnit", "Portfolio"]) || cleanString(normalized.portfolio || normalized.ownershipGroup),
      key
    };
  }

  function addCentralEmployee(map, raw = {}, meta = {}) {
    const normalized = normalizeCentralEmployee(raw, meta);
    if (!normalized.name) return;
    if (!employeeIsActive(raw, meta.normalized)) return;
    if (!employeeCentralSignal(raw, { ...meta.normalized, department: normalized.department, title: normalized.title })) return;
    const existing = map.get(normalized.key);
    map.set(normalized.key, {
      ...existing,
      ...normalized,
      department: normalized.department || existing?.department || "",
      title: normalized.title || existing?.title || "",
      email: normalized.email || existing?.email || "",
      employeeId: normalized.employeeId || existing?.employeeId || normalized.key
    });
  }

  function addPeopleEmployee(map, raw = {}, meta = {}) {
    const normalized = normalizeCentralEmployee(raw, meta);
    if (!normalized.name) return;
    if (!employeeIsActive(raw, meta.normalized)) return;
    const key = normalized.employeeId || normalized.peopleEmployeeId || normalized.key;
    const existing = map.get(key);
    map.set(key, {
      ...existing,
      ...normalized,
      active: true,
      department: normalized.department || existing?.department || "",
      title: normalized.title || existing?.title || "",
      email: normalized.email || existing?.email || "",
      employeeId: normalized.employeeId || existing?.employeeId || key,
      peopleEmployeeId: normalized.peopleEmployeeId || existing?.peopleEmployeeId || ""
    });
  }

  function getPeopleEmployees() {
    const employees = new Map();
    try {
      if (typeof loadPeoplePlatformStateForSharedData === "function") {
        const peopleState = loadPeoplePlatformStateForSharedData() || {};
        asArray(peopleState.employees).forEach(employee => addPeopleEmployee(employees, employee, { source: "People roster" }));
      }
    } catch {
      // Keep any other sources that are available.
    }
    try {
      const key = typeof PERFORMANCE_PLATFORM_STORAGE_KEY !== "undefined" ? PERFORMANCE_PLATFORM_STORAGE_KEY : "rise_performance_platform_github_v1";
      const peopleState = safeJsonParse(storageGet(key), {});
      asArray(peopleState.employees).forEach(employee => addPeopleEmployee(employees, employee, { source: "People roster" }));
    } catch {
      // Keep any other sources that are available.
    }
    try {
      if (typeof atlasSharedData !== "undefined") {
        Object.values(asObject(atlasSharedData.employees)).forEach(employee => {
          addPeopleEmployee(employees, employee, { source: "ATLAS shared people", normalized: employee });
        });
      }
    } catch {
      // Shared data has not loaded yet.
    }
    return [...employees.values()].sort((left, right) => left.name.localeCompare(right.name));
  }

  function getCentralServicesEmployees() {
    const employees = new Map();
    try {
      if (typeof loadPeoplePlatformStateForSharedData === "function") {
        const peopleState = loadPeoplePlatformStateForSharedData() || {};
        asArray(peopleState.employees).forEach(employee => addCentralEmployee(employees, employee, { source: "People roster" }));
      }
    } catch {
      // Keep any other sources that are available.
    }
    try {
      const key = typeof PERFORMANCE_PLATFORM_STORAGE_KEY !== "undefined" ? PERFORMANCE_PLATFORM_STORAGE_KEY : "rise_performance_platform_github_v1";
      const peopleState = safeJsonParse(storageGet(key), {});
      asArray(peopleState.employees).forEach(employee => addCentralEmployee(employees, employee, { source: "People roster" }));
    } catch {
      // Keep any other sources that are available.
    }
    try {
      if (typeof atlasSharedData !== "undefined") {
        Object.values(asObject(atlasSharedData.employees)).forEach(employee => {
          addCentralEmployee(employees, employee, { source: "ATLAS shared people", normalized: employee });
        });
      }
    } catch {
      // Shared data has not loaded yet.
    }
    return [...employees.values()].sort((left, right) => left.name.localeCompare(right.name));
  }

  function defaultOwner(centralEmployees) {
    return centralEmployees[0]?.name || "Unassigned";
  }

  function ownerOptionsHtml(centralEmployees, selectedOwner) {
    const names = ["Unassigned", ...centralEmployees.map(employee => employee.name)].filter(Boolean);
    return [...new Set(names)].map(name => `<option value="${escapeAttr(name)}" ${name === selectedOwner ? "selected" : ""}>${escapeHtml(name)}</option>`).join("");
  }

  function employeeHomeProperty(employee = {}) {
    return cleanString(employee.homeProperty || employee.assignedProperty || employee.propertyName || employee.communityName);
  }

  function employeeMatchesProperty(employee = {}, propertyName = "") {
    const home = normalizeKey(employeeHomeProperty(employee));
    const target = normalizeKey(propertyName);
    return Boolean(home && target && home === target);
  }

  function employeeRegion(employee = {}) {
    return cleanString(employee.region || employee.market || employee.regional);
  }

  function propertyRegion(propertyName = "") {
    const property = getPortfolioProperties().find(item => item.name === propertyName);
    return cleanString(property?.region || property?.market);
  }

  function employeeInspectionSearchText(employee = {}) {
    return normalizeKey([
      employee.name,
      employee.employeeId,
      employee.peopleEmployeeId,
      employee.employeeNumber,
      employee.title,
      employee.department,
      employeeHomeProperty(employee),
      employeeRegion(employee),
      employee.portfolio
    ].join(" "));
  }

  function employeeIsInspectionEligible(state, employee = {}) {
    if (!employee?.active && !employeeIsActive(employee, employee)) return false;
    const roleText = normalizeKey([employee.title, employee.role, employee.position, employee.department].join(" "));
    const signals = uniqueStrings(asArray(state.workflowSettings.inspectionEligibleRoleSignals));
    return signals.some(signal => roleText.includes(normalizeKey(signal)));
  }

  function getInspectionEligibleEmployees(state) {
    return getPeopleEmployees().filter(employee => employeeIsInspectionEligible(state, employee));
  }

  function inspectionEmployeeOptionLabel(employee = {}, context = "") {
    const home = employeeHomeProperty(employee);
    const title = cleanString(employee.title || employee.department);
    const suffix = [title, home ? `Home: ${home}` : "", employeeRegion(employee), context].filter(Boolean).join(" / ");
    return `${employee.name}${suffix ? ` - ${suffix}` : ""}`;
  }

  function inspectionEmployeeOption(employee = {}, selected = "", context = "") {
    const value = cleanString(employee.employeeId || employee.peopleEmployeeId || employee.name);
    const selectedKey = normalizeKey(selected);
    const isSelected = selectedKey && [value, employee.peopleEmployeeId, employee.name].some(item => normalizeKey(item) === selectedKey);
    return `<option value="${escapeAttr(value)}" ${isSelected ? "selected" : ""}>${escapeHtml(inspectionEmployeeOptionLabel(employee, context))}</option>`;
  }

  function inspectionEmployeeOptionsHtml(state, selected = "", propertyName = "", search = "") {
    const employees = getInspectionEligibleEmployees(state);
    const query = normalizeKey(search);
    const targetRegion = normalizeKey(propertyRegion(propertyName));
    const included = new Set();
    const filterBySearch = employee => !query || employeeInspectionSearchText(employee).includes(query);
    const assigned = employees.filter(employee => employeeMatchesProperty(employee, propertyName)).filter(filterBySearch);
    assigned.forEach(employee => included.add(cleanString(employee.employeeId || employee.peopleEmployeeId || employee.name)));
    const related = employees
      .filter(employee => !included.has(cleanString(employee.employeeId || employee.peopleEmployeeId || employee.name)))
      .filter(employee => targetRegion && normalizeKey(employeeRegion(employee)) === targetRegion)
      .filter(filterBySearch);
    related.forEach(employee => included.add(cleanString(employee.employeeId || employee.peopleEmployeeId || employee.name)));
    const all = employees
      .filter(employee => !included.has(cleanString(employee.employeeId || employee.peopleEmployeeId || employee.name)))
      .filter(filterBySearch);
    const group = (label, rows, context = "") => rows.length ? `<optgroup label="${escapeAttr(label)}">${rows.map(employee => inspectionEmployeeOption(employee, selected, context)).join("")}</optgroup>` : "";
    const fallback = `<option value="Unassigned" ${selected === "Unassigned" || !selected ? "selected" : ""}>Unassigned</option>`;
    return `${fallback}${group("Assigned to this property", assigned)}${group("Eligible from related properties", related, "temporary support")}${group("Assign Another Technician - All Active Eligible", all, "temporary support")}`;
  }

  function findInspectionEligibleEmployee(state, value = "") {
    const target = normalizeKey(value);
    return getInspectionEligibleEmployees(state).find(employee => {
      return [employee.employeeId, employee.peopleEmployeeId, employee.employeeNumber, employee.email, employee.name]
        .some(item => normalizeKey(item) === target);
    }) || null;
  }

  function defaultInspectorForProperty(state, propertyName = "") {
    const eligible = getInspectionEligibleEmployees(state);
    const direct = eligible.find(employee => employeeMatchesProperty(employee, propertyName));
    if (direct) return direct;
    const region = normalizeKey(propertyRegion(propertyName));
    return eligible.find(employee => region && normalizeKey(employeeRegion(employee)) === region) || eligible[0] || null;
  }

  function applyInspectionAssignment(state, caseRecord, inspection, employee, reason = "") {
    const actor = currentActor();
    const assignedAt = new Date().toISOString();
    const priorName = inspection?.inspectorName || caseRecord?.inspectorName || "Unassigned";
    const employeeId = cleanString(employee.employeeId || employee.peopleEmployeeId || employee.name);
    const assignment = {
      assignedEmployeeName: employee.name,
      assignedEmployeeId: employeeId,
      peopleEmployeeId: employee.peopleEmployeeId || "",
      homeProperty: employeeHomeProperty(employee),
      inspectionProperty: caseRecord?.propertyName || inspection?.propertyName || "",
      assignedBy: actor.name,
      assignedByUserId: actor.userId,
      assignedAt,
      inspectionId: inspection?.id || "",
      taskId: "",
      reason: cleanString(reason),
      priorInspector: priorName
    };
    if (caseRecord) {
      caseRecord.inspectorName = employee.name;
      caseRecord.inspectorEmployeeId = employeeId;
      caseRecord.inspectorHomeProperty = assignment.homeProperty;
      caseRecord.temporaryInspectionAssignment = assignment;
      caseRecord.inspectionAssignmentHistory = asArray(caseRecord.inspectionAssignmentHistory);
      caseRecord.inspectionAssignmentHistory.unshift(assignment);
      pushCaseActivity(caseRecord, `Assigned inspector to ${employee.name}.`, {
        previousStatus: priorName,
        newStatus: employee.name,
        memo: assignment.reason,
        assignedEmployeeId: employeeId,
        homeProperty: assignment.homeProperty
      });
    }
    if (inspection) {
      inspection.inspectorName = employee.name;
      inspection.inspectorEmployeeId = employeeId;
      inspection.inspectorHomeProperty = assignment.homeProperty;
      inspection.inspectionProperty = assignment.inspectionProperty;
      inspection.temporaryOperationalAssignment = assignment;
      inspection.assignmentHistory = asArray(inspection.assignmentHistory);
      inspection.assignmentHistory.unshift(assignment);
      inspection.updatedAt = assignedAt;
      pushInspectionAudit(inspection, `Inspector assigned to ${employee.name}.`, {
        previousInspector: priorName,
        newInspector: employee.name,
        assignedBy: actor.name,
        reason: assignment.reason,
        homeProperty: assignment.homeProperty,
        inspectionProperty: assignment.inspectionProperty
      });
    }
    const taskId = makeId("task", [inspection?.id || caseRecord?.id, employeeId, "inspection-assignment"]);
    assignment.taskId = taskId;
    const existingTask = state.tasks.find(task => task.id === taskId);
    const taskPayload = {
      id: taskId,
      sourceCaseId: caseRecord?.id || inspection?.relatedMoveOutId || "",
      sourceInspectionId: inspection?.id || "",
      type: "Inspection",
      propertyName: assignment.inspectionProperty,
      residentName: caseRecord?.residentName || inspection?.residentName || "",
      title: `Complete ${inspection?.templateName || "Move-Out Inspection"}${caseRecord?.unit ? ` for Unit ${caseRecord.unit}` : ""}`,
      owner: employee.name,
      ownerEmployeeId: employeeId,
      ownerEmail: employee.email || "",
      dueDate: inspection?.inspectionDate || caseRecord?.inspectionDate || TODAY_ISO,
      status: "Open",
      waitingOn: "",
      priority: "High",
      createdAt: assignedAt,
      temporaryOperationalAssignment: assignment
    };
    if (existingTask) Object.assign(existingTask, taskPayload, { createdAt: existingTask.createdAt || assignedAt });
    else state.tasks.unshift(taskPayload);
    addAudit(state, "Assigned move-out inspector", assignment);
    return assignment;
  }

  function statusPill(status) {
    return `<span class="cs-status" data-status="${escapeAttr(status)}">${escapeHtml(status || "Not Started")}</span>`;
  }

  function icon(name) {
    return `<i class="ph ph-${escapeAttr(name)}" aria-hidden="true"></i>`;
  }

  function propertyOptionsHtml(selected, includeAll = true) {
    const all = includeAll ? `<option value="all" ${selected === "all" ? "selected" : ""}>All ATLAS properties</option>` : "";
    return `${all}${getPortfolioProperties().map(property => `<option value="${escapeAttr(property.name)}" ${property.name === selected ? "selected" : ""}>${escapeHtml(property.name)}</option>`).join("")}`;
  }

  function monthOptionsHtml(selectedIdx) {
    return MONTH_LABELS.map((label, idx) => `<option value="${idx}" ${idx === selectedIdx ? "selected" : ""}>${escapeHtml(label)}</option>`).join("");
  }

  function genericOptionsHtml(values, selected, placeholder = "") {
    const head = placeholder ? `<option value="">${escapeHtml(placeholder)}</option>` : "";
    return `${head}${asArray(values).map(value => `<option value="${escapeAttr(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(value)}</option>`).join("")}`;
  }

  function inspectionTemplateOptionsHtml(state, selected) {
    return state.inspectionTemplates
      .filter(template => template.active !== false)
      .map(template => `<option value="${escapeAttr(template.id)}" ${template.id === selected ? "selected" : ""}>${escapeHtml(template.name)}</option>`)
      .join("");
  }

  function chargebackOptionsHtml(state, selected, placeholder = "No chargeback") {
    const rows = state.chargebackCatalog.filter(item => item.active !== false);
    return `${placeholder ? `<option value="">${escapeHtml(placeholder)}</option>` : ""}${rows.map(item => `<option value="${escapeAttr(item.id)}" ${item.id === selected ? "selected" : ""}>${escapeHtml(item.item)}${item.portfolioCost ? ` - ${escapeHtml(formatMoney(item.portfolioCost))}` : ""}</option>`).join("")}`;
  }

  function roomOptionsHtml(state, selected) {
    return genericOptionsHtml(state.roomLibrary, selected, "Choose room");
  }

  function componentOptionsHtml(state, selected) {
    return genericOptionsHtml(state.componentLibrary, selected, "Choose component");
  }

  function conditionOptionsHtml(template, selected) {
    return genericOptionsHtml(template?.conditionChoices || DEFAULT_CONDITION_CHOICES, selected, "Select condition");
  }

  function yesNoOptionsHtml(selected) {
    return genericOptionsHtml(["Yes", "No"], selected || "No");
  }

  function statusOptionsHtml(values, selected) {
    return asArray(values).map(status => `<option value="${escapeAttr(status)}" ${status === selected ? "selected" : ""}>${escapeHtml(status)}</option>`).join("");
  }

  function checkboxListHtml(values, selectedValues, name, onchange) {
    const selected = new Set(asArray(selectedValues));
    return `<div class="cs-check-list">${asArray(values).map(value => `<label><input type="checkbox" name="${escapeAttr(name)}" value="${escapeAttr(value)}" ${selected.has(value) ? "checked" : ""} ${onchange ? `onchange="${escapeAttr(onchange)}"` : ""}><span>${escapeHtml(value)}</span></label>`).join("")}</div>`;
  }

  function renderMiniTimeline(items) {
    const rows = asArray(items).slice(0, 8);
    if (!rows.length) return `<div class="cs-alert">No audit entries have been recorded for this item yet.</div>`;
    return `<div class="cs-timeline">${rows.map(item => {
      const transition = item.previousStatus || item.newStatus ? ` (${[item.previousStatus, item.newStatus].filter(Boolean).join(" -> ")})` : "";
      const memo = item.memo ? ` - ${item.memo}` : "";
      const user = item.user ? ` by ${item.user}` : "";
      return `<div class="cs-timeline-item"><div class="cs-timeline-date">${escapeHtml(formatDate(item.at) || formatDate(item.date) || "Now")}</div><div class="cs-timeline-copy">${escapeHtml(`${item.label || item.reason || item.action || "Updated"}${transition}${memo}${user}`)}</div></div>`;
    }).join("")}</div>`;
  }

  function renderModuleNav(state) {
    return `<div class="cs-module-nav" role="tablist" aria-label="Central Services modules">
      ${MODULES.map(([key, label, iconName]) => `<button type="button" class="cs-module-tab ${state.ui.module === key ? "is-active" : ""}" onclick="atlasCsSetModule('${key}')">${icon(iconName)} ${escapeHtml(label)}</button>`).join("")}
    </div>`;
  }

  function renderControls(state) {
    const monthIdx = selectedMonthIdx(state);
    return `<div class="cs-panel">
      <div class="cs-panel-body">
        <div class="cs-control-grid">
          <label class="cs-field">
            <span>Property Scope</span>
            <select onchange="atlasCsSetProperty(this.value)">${propertyOptionsHtml(state.ui.propertyId, true)}</select>
          </label>
          <label class="cs-field">
            <span>Reporting Month</span>
            <select onchange="atlasCsSetMonth(this.value)">${monthOptionsHtml(monthIdx)}</select>
          </label>
          <label class="cs-field">
            <span>Reporting Year</span>
            <input type="number" min="2020" max="2035" value="${escapeAttr(selectedYear(state))}" onchange="atlasCsSetYear(this.value)">
          </label>
          <label class="cs-field" style="grid-column:span 3">
            <span>Search Imported Workflow Records</span>
            <input type="search" value="${escapeAttr(state.ui.search)}" placeholder="Resident, unit, property, owner, status" onchange="atlasCsSetSearch(this.value)">
          </label>
        </div>
      </div>
    </div>`;
  }

  function renderKpi(config) {
    return `<button type="button" class="cs-kpi" data-tone="${escapeAttr(config.tone || "")}" data-module="${escapeAttr(config.module || "overview")}" data-filter="${escapeAttr(config.filter || "")}" onclick="atlasCsDrill(this.dataset.module,this.dataset.filter)">
      <div class="cs-kpi-top">
        <div class="cs-kpi-label">${escapeHtml(config.label)}</div>
        <div class="cs-kpi-icon">${icon(config.icon || "chart-line")}</div>
      </div>
      <div class="cs-kpi-value">${escapeHtml(config.value)}</div>
      <div class="cs-kpi-sub">${escapeHtml(config.sub || "Click to open the records behind this card.")}</div>
    </button>`;
  }

  function renderKpiGrid(state, employees) {
    const kpis = getKpis(state, employees);
    const retention = kpis.expirations > 0 ? kpis.signed / kpis.expirations * 100 : null;
    return `<div class="cs-kpi-grid">
      ${renderKpi({ label: "Properties in Scope", value: formatNumber(kpis.propertyCount), sub: "Compiled from the ATLAS property list.", icon: "buildings", module: "renewals" })}
      ${renderKpi({ label: "Central Services Roster", value: formatNumber(kpis.rosterCount), sub: "Employees whose roster department includes Centra or Central Services.", icon: "users-three", module: "settings" })}
      ${renderKpi({ label: "Renewal Expirations", value: formatNumber(kpis.expirations), sub: `${MONTH_LABELS[selectedMonthIdx(state)]} ${selectedYear(state)} across selected properties.`, icon: "calendar-dots", module: "renewals" })}
      ${renderKpi({ label: "Renewal Conversion", value: formatPercent(retention), sub: "Signed renewals divided by expirations from ATLAS or imported rows.", icon: "trend-up", tone: "green", module: "renewals" })}
      ${renderKpi({ label: "Pending Decisions", value: formatNumber(kpis.undecided), sub: "Outstanding renewal decisions in the selected period.", icon: "hourglass", tone: "amber", module: "renewals", filter: "pending" })}
      ${renderKpi({ label: "NTV / Move-Out Exposure", value: formatNumber(kpis.ntv), sub: "Notices to vacate from ATLAS summaries or imported renewal records.", icon: "door", tone: "red", module: "moveOuts" })}
      ${renderKpi({ label: "Detailed Move-Out Cases", value: formatNumber(kpis.moveOutCaseCount), sub: "Only cases created from imported records or Central Services actions.", icon: "folders", tone: "violet", module: "moveOuts" })}
      ${renderKpi({ label: "Hold Over Move-Outs", value: formatNumber(kpis.holdovers), sub: "Possession was expected but has not been confirmed.", icon: "warning-circle", tone: kpis.holdovers ? "red" : "green", module: "moveOuts", filter: "holdover" })}
      ${renderKpi({ label: "Field Inspections", value: formatNumber(kpis.inspectionsInProgress), sub: `${formatNumber(kpis.inspectionsAwaitingApproval)} awaiting review or approval.`, icon: "clipboard-text", tone: "teal", module: "inspections" })}
      ${renderKpi({ label: "Inspection Approval", value: formatNumber(kpis.inspectionApprovals), sub: "Submitted move-out inspections waiting for Central Services review.", icon: "stamp", tone: kpis.inspectionApprovals ? "amber" : "green", module: "moveOuts", filter: "approval" })}
      ${renderKpi({ label: "MORFs Ready", value: formatNumber(kpis.morfsReady), sub: "Approved inspections ready for Central Services MORF processing.", icon: "files", tone: kpis.morfsReady ? "green" : "teal", module: "morfs", filter: "morfReady" })}
      ${renderKpi({ label: "MORFs Due", value: formatNumber(kpis.morfsDue), sub: `${formatNumber(kpis.morfsOverdue)} past the internal SLA.`, icon: "files", tone: kpis.morfsOverdue ? "red" : "amber", module: "morfs" })}
      ${renderKpi({ label: "Legal Deadline Risk", value: formatNumber(kpis.legalDeadlineRisk), sub: "Records close to or past state-configured deposit deadlines.", icon: "alarm", tone: kpis.legalDeadlineRisk ? "red" : "green", module: "moveOuts", filter: "risk" })}
      ${renderKpi({ label: "Missing Documentation", value: formatNumber(kpis.missingDocumentation), sub: `${formatNumber(kpis.photoOverrides)} photo overrides in the permanent audit trail.`, icon: "image-square", tone: kpis.missingDocumentation ? "red" : "green", module: "inspections" })}
      ${renderKpi({ label: "Resident Disputes", value: formatNumber(kpis.disputesOpen), sub: "Open dispute or revision records tied to MORF statements.", icon: "chats-circle", tone: kpis.disputesOpen ? "red" : "green", module: "disputes" })}
      ${renderKpi({ label: "Archived MORFs", value: formatNumber(kpis.archivedMorfs), sub: "Searchable post-handoff move-out and dispute records.", icon: "archive-box", tone: "teal", module: "archive" })}
      ${renderKpi({ label: "Open Work Queue", value: formatNumber(kpis.openTasks), sub: `${formatNumber(kpis.overdueTasks)} overdue tasks in the selected scope.`, icon: "check-square-offset", tone: kpis.overdueTasks ? "red" : "teal", module: "tasks" })}
    </div>`;
  }

  function renderRosterPanel(employees) {
    if (!employees.length) {
      return `<div class="cs-alert is-warn">
        No Central Services employees were found from the employee roster yet. The roster filter is looking for active employees whose department, org unit, business unit, cost center, team, or division contains "Centra" or "Central Services".
      </div>`;
    }
    return `<div class="cs-table-wrap">
      <table class="cs-table">
        <thead><tr><th>Employee</th><th>Title</th><th>Department</th><th>Email</th><th>Source</th></tr></thead>
        <tbody>
          ${employees.map(employee => `<tr>
            <td><div class="cs-name-cell"><strong>${escapeHtml(employee.name)}</strong><span>${escapeHtml(employee.employeeNumber || employee.peopleEmployeeId || employee.employeeId)}</span></div></td>
            <td>${escapeHtml(employee.title || "Not listed")}</td>
            <td>${escapeHtml(employee.department || "Matched from available roster fields")}</td>
            <td>${employee.email ? `<a href="mailto:${escapeAttr(employee.email)}">${escapeHtml(employee.email)}</a>` : "Not listed"}</td>
            <td>${escapeHtml(employee.source)}</td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
  }

  function getInspectionTemplateById(state, templateId) {
    return state.inspectionTemplates.find(template => template.id === templateId) || state.inspectionTemplates[0] || defaultInspectionTemplates()[0];
  }

  function getChargebackCatalogItem(state, chargebackId) {
    return state.chargebackCatalog.find(item => item.id === chargebackId) || null;
  }

  function getMarketMultiplierForProperty(state, propertyName) {
    const zip = getPropertyZipCode(propertyName);
    const configured = asObject(state.workflowSettings.zipMultipliers);
    if (zip && Number(configured[zip]) > 0) return Number(configured[zip]);
    return Number(state.workflowSettings.defaultMarketZipMultiplier) > 0 ? Number(state.workflowSettings.defaultMarketZipMultiplier) : 1;
  }

  function calculateCatalogCharge(state, catalogItem, propertyName) {
    if (!catalogItem) {
      return {
        portfolioStandard: 0,
        marketMultiplier: getMarketMultiplierForProperty(state, propertyName),
        marketRate: 0,
        propertyOverride: 0,
        recommendedCharge: 0
      };
    }
    const portfolioStandard = numberValue(catalogItem.portfolioCost);
    const itemMultiplier = Number(catalogItem.marketAdjustment);
    const marketMultiplier = itemMultiplier > 0 && itemMultiplier !== 1
      ? itemMultiplier
      : getMarketMultiplierForProperty(state, propertyName);
    const marketRate = Math.round(portfolioStandard * marketMultiplier);
    const override = numberValue(asObject(catalogItem.propertyOverrides)[propertyName]);
    return {
      portfolioStandard,
      marketMultiplier,
      marketRate,
      propertyOverride: override,
      recommendedCharge: override || marketRate
    };
  }

  function formatChargeCalculation(state, catalogItem, propertyName) {
    const calc = calculateCatalogCharge(state, catalogItem, propertyName);
    return [
      `Portfolio Standard: ${formatMoney(calc.portfolioStandard) || "$0"}`,
      `ZIP Market Multiplier: ${calc.marketMultiplier.toFixed(2)}`,
      `Calculated Market Rate: ${formatMoney(calc.marketRate) || "$0"}`,
      `Property Override: ${calc.propertyOverride ? formatMoney(calc.propertyOverride) : "None"}`,
      `Recommended Property Charge: ${formatMoney(calc.recommendedCharge) || "$0"}`
    ].join(" | ");
  }

  function getInspectionLocationLabel(inspection) {
    if (inspection.locationType === "Common Area") {
      return [inspection.building, inspection.floor, inspection.commonAreaType || inspection.locationName].filter(Boolean).join(" / ") || "Common area";
    }
    return [inspection.building, inspection.floor, inspection.unit ? `Unit ${inspection.unit}` : "", inspection.room].filter(Boolean).join(" / ") || "Apartment";
  }

  function getInspectionRelatedCase(state, inspection) {
    return state.moveOutCases.find(item => item.id === inspection.relatedMoveOutId) || null;
  }

  function getMorfForCase(state, caseId) {
    return state.morfRecords.find(morf => morf.moveOutCaseId === caseId) || null;
  }

  function calculateVendorScore(vendor) {
    const quality = whole(vendor.qualityScore);
    const cost = whole(vendor.costScore);
    const reliability = whole(vendor.reliabilityScore);
    const compliance = whole(vendor.complianceScore);
    const base = Math.round((quality * 0.34) + (reliability * 0.28) + (compliance * 0.24) + (cost * 0.14));
    const callbackPenalty = Math.min(15, whole(vendor.warrantyCallbacks) * 2);
    const infractionPenalty = Math.min(25, whole(vendor.vendorInfractions) * 5);
    const complaintPenalty = Math.min(15, whole(vendor.residentComplaints) * 3);
    return Math.max(0, Math.min(100, base - callbackPenalty - infractionPenalty - complaintPenalty));
  }

  function vendorRecommendationReason(vendor) {
    const score = calculateVendorScore(vendor);
    if (!vendor.name) return "";
    const issues = [];
    if (normalizeKey(vendor.complianceStatus).includes("issue") || normalizeKey(vendor.complianceStatus).includes("expired")) issues.push("compliance review required");
    if (whole(vendor.openWorkOrders) > 8) issues.push(`${whole(vendor.openWorkOrders)} open assignments`);
    const positives = [
      `${score} overall score`,
      `${whole(vendor.qualityScore)} quality score`,
      `${whole(vendor.reliabilityScore)} reliability score`
    ];
    return issues.length
      ? `Review before assigning because ${issues.join(", ")}.`
      : `Recommended because this vendor has a ${positives.join(", ")} and ${whole(vendor.openWorkOrders)} open assignments.`;
  }

  function propertyEmployeeOptionsHtml(employees, selected) {
    const names = ["Unassigned", ...employees.map(employee => employee.name)].filter(Boolean);
    return [...new Set(names)].map(name => `<option value="${escapeAttr(name)}" ${name === selected ? "selected" : ""}>${escapeHtml(name)}</option>`).join("");
  }

  function renderTaskTable(state, options = {}) {
    const tasks = getScopedTasks(state).filter(task => options.openOnly ? task.status !== "Completed" : true);
    if (!tasks.length) {
      return `<div class="cs-empty"><div><strong>No Central Services tasks yet.</strong><br>Tasks will appear here after a real renewal import creates workflow work or after users create assignments from Central Services records.</div></div>`;
    }
    return `<div class="cs-table-wrap">
      <table class="cs-table">
        <thead><tr><th>Task</th><th>Property</th><th>Owner</th><th>Due</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${tasks.map(task => {
            const dueDelta = daysUntil(task.dueDate);
            const dueTone = dueDelta !== null && dueDelta < 0 && task.status !== "Completed" ? "Overdue" : task.status;
            return `<tr>
              <td><div class="cs-name-cell"><strong>${escapeHtml(task.title)}</strong><span>${escapeHtml([task.type, task.residentName].filter(Boolean).join(" - "))}</span></div></td>
              <td>${escapeHtml(task.propertyName)}</td>
              <td>${escapeHtml(task.owner || "Unassigned")}</td>
              <td>${escapeHtml(formatDate(task.dueDate) || "Not dated")}</td>
              <td>${statusPill(dueTone || "Open")}</td>
              <td class="right">
                <button type="button" class="cs-btn cs-btn-sm" data-id="${escapeAttr(task.id)}" onclick="atlasCsOpenTask(this.dataset.id)">Open</button>
                <button type="button" class="cs-btn cs-btn-sm" data-id="${escapeAttr(task.id)}" onclick="atlasCsToggleTask(this.dataset.id)">${task.status === "Completed" ? "Reopen" : "Complete"}</button>
              </td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>`;
  }

  function getCentralDashboardPreferences(state) {
    const userKey = centralDashboardUserKey();
    state.dashboardPreferencesByUser = asObject(state.dashboardPreferencesByUser);
    const current = normalizeCentralDashboardPreferences(state.dashboardPreferencesByUser[userKey], userKey);
    state.dashboardPreferencesByUser[userKey] = current;
    return current;
  }

  function setCentralDashboardPreferences(state, prefs) {
    const normalized = normalizeCentralDashboardPreferences(prefs, centralDashboardUserKey());
    state.dashboardPreferencesByUser = asObject(state.dashboardPreferencesByUser);
    state.dashboardPreferencesByUser[normalized.userKey] = normalized;
    return normalized;
  }

  function getCentralDashboardWidgets(state) {
    return asArray(getCentralDashboardPreferences(state).widgets)
      .map(normalizeCentralDashboardWidgetInstance)
      .filter(Boolean)
      .sort((left, right) => {
        if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
        return (Number(left.position) || 0) - (Number(right.position) || 0);
      })
      .map((widget, index) => ({ ...widget, position: index }));
  }

  function centralDashboardDefinitionCategories() {
    return ["All", ...uniqueStrings(CENTRAL_DASHBOARD_WIDGETS.map(widget => widget.category))];
  }

  function centralDashboardRow(fields = {}, options = {}) {
    return {
      id: cleanString(options.id),
      recordType: cleanString(options.recordType || "record"),
      module: cleanString(options.module || "overview"),
      filter: cleanString(options.filter || "all"),
      title: cleanString(options.title || Object.values(fields).find(Boolean) || "Record"),
      subtitle: cleanString(options.subtitle),
      fields,
      status: cleanString(options.status),
      tone: cleanString(options.tone),
      primaryDate: normalizeDate(options.primaryDate || options.dueDate || options.date),
      dueDate: normalizeDate(options.dueDate || options.primaryDate || options.date),
      completedAt: normalizeDate(options.completedAt),
      ageDays: Number.isFinite(Number(options.ageDays)) ? Number(options.ageDays) : null,
      priority: whole(options.priority),
      actions: asArray(options.actions)
    };
  }

  function dashboardPropertyNameForRecord(record = {}) {
    return cleanString(record.propertyName || record.property || record.communityName || record.community || record.inspectionProperty || record.locationProperty);
  }

  function centralDashboardPropertySet(state, widget = {}) {
    if (widget.propertyScope === "all") return new Set(getPortfolioProperties().map(property => property.name));
    if (widget.propertyScope === "single" && widget.propertyName) return new Set([widget.propertyName]);
    return new Set(getScopedProperties(state).map(property => property.name));
  }

  function rowMatchesCentralDashboardScope(state, widget, record = {}) {
    const propertyName = dashboardPropertyNameForRecord(record);
    if (!propertyName) return true;
    return centralDashboardPropertySet(state, widget).has(propertyName);
  }

  function centralDashboardDateRangeMatches(widget = {}, row = {}) {
    const range = widget.dateRange || "All Open";
    const date = row.dueDate || row.primaryDate;
    const delta = daysUntil(date);
    if (range === "All Open") return true;
    if (range === "Today") return delta === 0;
    if (range === "Overdue") return delta !== null && delta < 0;
    if (range === "Next 7 Days") return delta !== null && delta >= 0 && delta <= 7;
    if (range === "Next 14 Days") return delta !== null && delta >= 0 && delta <= 14;
    if (range === "Next 30 Days") return delta !== null && delta >= 0 && delta <= 30;
    if (range === "Current Month") return Boolean(date && date.slice(0, 7) === TODAY_ISO.slice(0, 7));
    if (range === "Recently Completed") {
      const completedDelta = daysUntil(row.completedAt || date);
      return completedDelta !== null && completedDelta <= 0 && completedDelta >= -14;
    }
    return true;
  }

  function centralDashboardAgingMatches(widget = {}, row = {}) {
    const filter = widget.agingFilter || "All Ages";
    const age = row.ageDays !== null && row.ageDays !== undefined
      ? Number(row.ageDays)
      : row.dueDate
        ? Math.max(0, -1 * (daysUntil(row.dueDate) || 0))
        : 0;
    if (filter === "All Ages") return true;
    if (filter === "Due Today") return row.dueDate && daysUntil(row.dueDate) === 0;
    if (filter === "1-2 Days") return age >= 1 && age <= 2;
    if (filter === "3-5 Days") return age >= 3 && age <= 5;
    if (filter === "6-10 Days") return age >= 6 && age <= 10;
    if (filter === "Over 10 Days") return age > 10;
    return true;
  }

  function sortCentralDashboardRows(widget = {}, rows = []) {
    const order = widget.sortOrder || "Priority";
    const sorted = rows.slice();
    const byDate = (left, right) => (dateValue(left.dueDate || left.primaryDate) || 0) - (dateValue(right.dueDate || right.primaryDate) || 0);
    if (order === "Due Date" || order === "Days Remaining") return sorted.sort(byDate);
    if (order === "Days Overdue") return sorted.sort((left, right) => (Number(right.ageDays) || 0) - (Number(left.ageDays) || 0));
    if (order === "Newest") return sorted.sort((left, right) => (dateValue(right.primaryDate) || 0) - (dateValue(left.primaryDate) || 0));
    if (order === "Oldest") return sorted.sort((left, right) => (dateValue(left.primaryDate) || 0) - (dateValue(right.primaryDate) || 0));
    if (order === "Property") return sorted.sort((left, right) => cleanString(left.fields?.Property || left.fields?.["Property / Unit"]).localeCompare(cleanString(right.fields?.Property || right.fields?.["Property / Unit"])));
    if (order === "Assigned User") return sorted.sort((left, right) => cleanString(left.fields?.Assigned || left.fields?.Owner || left.fields?.Processor).localeCompare(cleanString(right.fields?.Assigned || right.fields?.Owner || right.fields?.Processor)));
    return sorted.sort((left, right) => {
      if ((Number(right.priority) || 0) !== (Number(left.priority) || 0)) return (Number(right.priority) || 0) - (Number(left.priority) || 0);
      return byDate(left, right);
    });
  }

  function centralDashboardPrepareRows(state, widget, rows = []) {
    return sortCentralDashboardRows(widget, rows.filter(row => centralDashboardDateRangeMatches(widget, row) && centralDashboardAgingMatches(widget, row)));
  }

  function ownerMatchesCurrentActor(owner = "", employeeId = "", email = "") {
    const actor = currentActor();
    const actorKey = normalizeKey([actor.userId, actor.email, actor.name].join(" "));
    if (!actorKey || actorKey === "central services" || actorKey === "central services central services") return true;
    const ownerKey = normalizeKey([owner, employeeId, email].join(" "));
    return Boolean(ownerKey && actorKey.split(/\s+/).some(token => token.length > 2 && ownerKey.includes(token)));
  }

  function moveOutBucketsForDashboardWidget(state, widget) {
    const buckets = {
      upcoming: [],
      holdover: [],
      inspections: [],
      approval: [],
      morfReady: [],
      morfInProgress: [],
      waiting: [],
      risk: [],
      sent: [],
      archived: []
    };
    const query = normalizeKey(state.ui.search);
    state.moveOutCases
      .filter(caseRecord => rowMatchesCentralDashboardScope(state, widget, caseRecord))
      .filter(caseRecord => !query || moveOutCaseMatchesSearch(caseRecord, query))
      .forEach(caseRecord => {
        const morf = getMorfForCase(state, caseRecord.id);
        const actualPossession = getActualPossessionDate(caseRecord);
        const inspection = getMoveOutInspectionForCase(state, caseRecord);
        const morfStatus = cleanString(morf?.status || caseRecord.morfSodaStatus);
        const legalRemaining = daysUntil(morf?.legalDeadline || calculateLegalDeadlineForCase(state, caseRecord));
        const sentToAccounting = caseRecord.accountingStatus === "Sent to Accounting" || morfStatus === "Sent to Accounting" || morf?.accountingHandoffStatus === "Sent to Accounting";
        const archived = Boolean(morf?.archivedAt) || ["Archived / Open", "MORF Closed"].includes(caseRecord.workflowStatus) || ["Sent to Accounting / Open", "MORF Closed"].includes(morf?.archiveStatus);
        if (sentToAccounting) buckets.sent.push(caseRecord);
        if (archived) {
          buckets.archived.push(caseRecord);
          return;
        }
        if (isHoldOverCase(caseRecord)) {
          buckets.holdover.push(caseRecord);
          return;
        }
        if (!actualPossession) {
          buckets.upcoming.push(caseRecord);
          return;
        }
        if (["Waiting on Site", "Waiting on Utilities", "Waiting on Documentation", "Waiting on Information"].includes(morfStatus)) buckets.waiting.push(caseRecord);
        if (legalRemaining !== null && legalRemaining <= 2) buckets.risk.push(caseRecord);
        if (!inspection || ["Draft", "HOLD - POSSESSION NOT RETURNED"].includes(inspection.status) || ["Move-Out Inspection", "Possession Confirmed", "Inspection Scheduled", "Inspection Pending"].includes(caseRecord.workflowStatus)) {
          buckets.inspections.push(caseRecord);
          return;
        }
        if (!caseInspectionIsApproved(state, caseRecord)) {
          buckets.approval.push(caseRecord);
          return;
        }
        if (["MORF In Progress", "Ready for Final Review", "MORF Finalized", "Approved"].includes(morfStatus)) {
          buckets.morfInProgress.push(caseRecord);
          return;
        }
        buckets.morfReady.push(caseRecord);
      });
    return buckets;
  }

  function dashboardDaysLabel(dateIso) {
    const delta = daysUntil(dateIso);
    if (delta === null) return "Not dated";
    if (delta < 0) return `${Math.abs(delta)} overdue`;
    if (delta === 0) return "Due today";
    return `${delta} days`;
  }

  function dashboardLastCommunication(caseRecord = {}) {
    const communications = asArray(caseRecord.communications);
    const latest = communications.slice().sort((left, right) => cleanString(right.createdAt).localeCompare(cleanString(left.createdAt)))[0];
    if (!latest) return "None recorded";
    return [formatDate(latest.createdAt), latest.type, latest.status].filter(Boolean).join(" / ");
  }

  function inspectionChargeSummary(state, inspection = {}) {
    const findings = asArray(inspection.findings).filter(findingHasResidentCharge);
    const total = findings.reduce((sum, finding) => {
      const item = getChargebackCatalogItem(state, finding.chargebackId);
      return sum + calculateCatalogCharge(state, item, inspection.propertyName).recommendedCharge;
    }, 0);
    return { count: findings.length, total };
  }

  function morfRecordForCase(state, caseRecord = {}) {
    return getMorfForCase(state, caseRecord.id) || {};
  }

  function moveOutCaseDashboardRow(state, caseRecord = {}, widget = {}, bucketKey = "") {
    const inspection = getMoveOutInspectionForCase(state, caseRecord);
    const morf = morfRecordForCase(state, caseRecord);
    const actualPossession = getActualPossessionDate(caseRecord);
    const legalDeadline = morf.legalDeadline || calculateLegalDeadlineForCase(state, caseRecord);
    const internalDue = morf.internalDueDate || calculateInternalMorfDueDate(state, caseRecord);
    const charges = morf.id ? getMorfTotals(morf).lawfulDeductions : inspectionChargeSummary(state, inspection).total;
    const base = {
      id: caseRecord.id,
      recordType: "moveOut",
      module: widget.module || "moveOuts",
      filter: widget.filter || bucketKey || "all",
      title: caseRecord.residentName,
      subtitle: `${caseRecord.propertyName} / Unit ${caseRecord.unit || "n/a"}`,
      status: caseRecord.workflowStatus || caseRecord.inspectionStatus,
      dueDate: internalDue || legalDeadline || caseRecord.inspectionDate || caseRecord.scheduledMoveOutDate,
      primaryDate: actualPossession || caseRecord.scheduledMoveOutDate,
      ageDays: caseRecord.scheduledMoveOutDate ? Math.max(0, -1 * (daysUntil(caseRecord.scheduledMoveOutDate) || 0)) : 0,
      priority: bucketKey === "holdover" || bucketKey === "risk" ? 100 : bucketKey === "approval" ? 70 : 40
    };
    if (widget.widgetKey === "holdover_move_outs") {
      return centralDashboardRow({
        "Resident": caseRecord.residentName,
        "Property / Unit": `${caseRecord.propertyName} / Unit ${caseRecord.unit || "n/a"}`,
        "Original Move-Out": formatDate(caseRecord.scheduledMoveOutDate) || "Not dated",
        "Days Overdue": dashboardDaysLabel(caseRecord.scheduledMoveOutDate),
        "Possession": caseRecord.possessionStatus || "Not Returned",
        "Last Communication": dashboardLastCommunication(caseRecord),
        "Assigned": caseRecord.owner || caseRecord.assignedCentralServicesUser || "Unassigned"
      }, {
        ...base,
        actions: [
          { label: "Notify", onclick: `atlasCsCreateResidentNotification('${escapeAttr(caseRecord.id)}')` },
          { label: "Adjust Dates", onclick: `atlasCsAdjustHoldoverDates('${escapeAttr(caseRecord.id)}')` },
          { label: "Memo", onclick: `atlasCsAddLifecycleMemo('${escapeAttr(caseRecord.id)}')` },
          { label: "Possession", onclick: `atlasCsConfirmPossession('${escapeAttr(caseRecord.id)}')` }
        ]
      });
    }
    if (widget.widgetKey === "legal_deadline_risk") {
      return centralDashboardRow({
        "Resident": caseRecord.residentName,
        "Property / Unit": `${caseRecord.propertyName} / Unit ${caseRecord.unit || "n/a"}`,
        "Actual Possession": formatDate(actualPossession) || "Needed",
        "State Deadline": formatDate(legalDeadline) || "Configure state",
        "Days Remaining": dashboardDaysLabel(legalDeadline),
        "Stage": caseRecord.workflowStatus || morf.status,
        "Assigned": caseRecord.owner || morf.processor || "Unassigned"
      }, base);
    }
    if (widget.widgetKey === "move_out_inspections") {
      return centralDashboardRow({
        "Resident": caseRecord.residentName,
        "Property / Unit": `${caseRecord.propertyName} / Unit ${caseRecord.unit || "n/a"}`,
        "Possession Returned": formatDate(actualPossession) || "Required",
        "Inspection Date": formatDate(inspection?.inspectionDate || caseRecord.inspectionDate) || "Not scheduled",
        "Inspector": inspection?.inspectorName || caseRecord.inspectorName || "Unassigned",
        "Status": inspection?.status || caseRecord.inspectionStatus || "Inspection Scheduled",
        "Days Overdue": dashboardDaysLabel(inspection?.inspectionDate || caseRecord.inspectionDate)
      }, { ...base, recordType: inspection?.id ? "inspection" : "moveOut", id: inspection?.id || caseRecord.id, module: "inspections" });
    }
    if (widget.widgetKey === "inspection_approval") {
      const summary = inspectionChargeSummary(state, inspection);
      return centralDashboardRow({
        "Resident": caseRecord.residentName,
        "Property / Unit": `${caseRecord.propertyName} / Unit ${caseRecord.unit || "n/a"}`,
        "Inspector": inspection?.inspectorName || caseRecord.inspectorName || "Unassigned",
        "Completed": formatDate(inspection?.submittedAt || caseRecord.inspectionCompletedAt) || "Submitted",
        "Charges": formatNumber(summary.count),
        "Charge Total": formatMoney(summary.total) || "$0",
        "Warnings": getInspectionMissingPhotoChargeCount(inspection) ? `${getInspectionMissingPhotoChargeCount(inspection)} documentation` : "Ready",
        "Approval": caseRecord.inspectionApprovalStatus || inspection?.status || "Awaiting Review"
      }, { ...base, recordType: inspection?.id ? "inspection" : "moveOut", id: inspection?.id || caseRecord.id, module: "inspections", priority: 75 });
    }
    if (widget.widgetKey === "morfs_ready") {
      return centralDashboardRow({
        "Resident": caseRecord.residentName,
        "Property / Unit": `${caseRecord.propertyName} / Unit ${caseRecord.unit || "n/a"}`,
        "Actual Possession": formatDate(actualPossession) || "Needed",
        "Internal Due": formatDate(internalDue) || "Not calculated",
        "State Deadline": formatDate(legalDeadline) || "Configure state",
        "Days Remaining": dashboardDaysLabel(legalDeadline || internalDue),
        "Deposit": formatMoney(caseRecord.depositHeld || morf.deposits?.[0]?.amount) || "$0",
        "Preliminary Charges": formatMoney(charges) || "$0",
        "Processor": morf.processor || caseRecord.owner || "Unassigned"
      }, { ...base, recordType: morf.id ? "morf" : "moveOut", id: morf.id || caseRecord.id, module: "morfs", priority: 65 });
    }
    if (widget.widgetKey === "morfs_in_progress") {
      return centralDashboardRow({
        "Resident": caseRecord.residentName,
        "Property / Unit": `${caseRecord.propertyName} / Unit ${caseRecord.unit || "n/a"}`,
        "Processor": morf.processor || caseRecord.owner || "Unassigned",
        "Started": formatDate(morf.startedAt) || "Started",
        "Internal Deadline": formatDate(internalDue) || "Not calculated",
        "Legal Deadline": formatDate(legalDeadline) || "Configure state",
        "Missing Information": getMorfCompletionMissing(state, morf).slice(0, 3).join(", ") || "Ready",
        "Status": morf.status || caseRecord.morfSodaStatus || "MORF In Progress"
      }, { ...base, recordType: morf.id ? "morf" : "moveOut", id: morf.id || caseRecord.id, module: "morfs", priority: 60 });
    }
    return centralDashboardRow({
      "Resident": caseRecord.residentName,
      "Property": caseRecord.propertyName,
      "Unit": caseRecord.unit || "n/a",
      "Scheduled Move-Out": formatDate(caseRecord.scheduledMoveOutDate) || "Not dated",
      "Days": dashboardDaysLabel(caseRecord.scheduledMoveOutDate),
      "Possession": caseRecord.possessionStatus || "Not Confirmed",
      "Inspection": caseRecord.inspectionStatus || "Not Scheduled",
      "Assigned CS User": caseRecord.assignedCentralServicesUser || caseRecord.owner || "Unassigned"
    }, base);
  }

  function dashboardTaskRow(task = {}, widget = {}) {
    const dueDelta = daysUntil(task.dueDate);
    const status = dueDelta !== null && dueDelta < 0 && task.status !== "Completed" ? "Overdue" : task.status || "Open";
    const age = task.dueDate ? Math.max(0, -1 * (dueDelta || 0)) : 0;
    return centralDashboardRow({
      "Item": task.title || task.type || "Task",
      "Task": task.title || task.type || "Task",
      "Type": task.type || "Task",
      "Property": task.propertyName || "",
      "Property / Unit": [task.propertyName, task.unit ? `Unit ${task.unit}` : ""].filter(Boolean).join(" / "),
      "Resident": task.residentName || "",
      "Owner": task.owner || "Unassigned",
      "Assigned": task.owner || "Unassigned",
      "Regional": task.assignedRegional || task.regional || "",
      "Vendor": task.vendor || task.vendorName || "",
      "Due": formatDate(task.dueDate) || "Not dated",
      "Age": age ? `${age} days` : "0 days",
      "Status": status,
      "Follow-Up": task.followUpRequired || task.waitingOn || task.status || ""
    }, {
      id: task.id,
      recordType: "task",
      module: widget.module || "tasks",
      title: task.title || task.type,
      subtitle: [task.propertyName, task.residentName].filter(Boolean).join(" / "),
      status,
      dueDate: task.dueDate,
      completedAt: task.completedAt,
      ageDays: age,
      priority: status === "Overdue" ? 80 : dueDelta === 0 ? 70 : 35
    });
  }

  function dashboardMorfRow(state, morf = {}, widget = {}) {
    const totals = getMorfTotals(morf);
    const timing = calculateAccountingTiming(morf);
    const handoff = asObject(morf.accountingHandoff);
    return centralDashboardRow({
      "Resident": morf.residentName,
      "Property / Unit": `${morf.propertyName} / Unit ${morf.unit || "n/a"}`,
      "Processor": morf.processor || "Unassigned",
      "Sent": formatDate(handoff.sentAt || morf.accountingSentAt || morf.archivedAt) || "Not sent",
      "Move-Out": formatDate(morf.possessionReturnedDate || morf.moveOutDate) || "Not captured",
      "Refund / Balance": totals.balanceDueToResident ? `${formatMoney(totals.balanceDueToResident)} refund` : totals.balanceDueToProperty ? `${formatMoney(totals.balanceDueToProperty)} due` : "$0",
      "State Deadline": formatDate(morf.legalDeadline) || "Not calculated",
      "Send-By": formatDate(timing.estimatedSendByDate) || "Not calculated",
      "Archive Status": morf.archiveStatus || morf.status || "Sent to Accounting / Open"
    }, {
      id: morf.id,
      recordType: "morf",
      module: widget.module || "archive",
      title: morf.residentName,
      subtitle: `${morf.propertyName} / Unit ${morf.unit || "n/a"}`,
      status: morf.archiveStatus || morf.status,
      primaryDate: handoff.sentAt || morf.accountingSentAt || morf.archivedAt,
      dueDate: morf.legalDeadline,
      ageDays: handoff.sentAt ? Math.max(0, -1 * (daysUntil(handoff.sentAt) || 0)) : 0,
      priority: daysUntil(morf.legalDeadline) !== null && daysUntil(morf.legalDeadline) <= 2 ? 80 : 25
    });
  }

  function dashboardPoRows(state, widget = {}) {
    const purchaseOrders = asArray(state.purchaseOrders)
      .filter(po => rowMatchesCentralDashboardScope(state, widget, po))
      .filter(po => normalizeKey(po.status || po.approvalStatus || po.stage).includes("regional") || normalizeKey(po.status || po.approvalStatus || po.stage).includes("awaiting approval"));
    const poRows = purchaseOrders.map(po => {
      const submitted = normalizeDate(po.dateSubmitted || po.submittedAt || po.createdAt);
      const age = submitted ? Math.max(0, -1 * (daysUntil(submitted) || 0)) : 0;
      return centralDashboardRow({
        "Property": dashboardPropertyNameForRecord(po),
        "PO #": po.poNumber || po.purchaseOrderNumber || po.id,
        "Vendor": po.vendorName || po.vendor || "",
        "Amount": formatMoney(po.amount) || "$0",
        "Submitted": formatDate(submitted) || "Not dated",
        "Regional": po.assignedRegional || po.regionalManager || "",
        "Age": `${age} days`,
        "Aging Status": age > 5 ? "Aging" : "Current"
      }, {
        id: po.id || po.poNumber,
        recordType: "po",
        module: "tasks",
        title: po.poNumber || po.purchaseOrderNumber || "Purchase Order",
        subtitle: [dashboardPropertyNameForRecord(po), po.vendorName || po.vendor].filter(Boolean).join(" / "),
        status: po.status || po.approvalStatus || "Awaiting Regional Approval",
        primaryDate: submitted,
        ageDays: age,
        priority: age > 5 ? 80 : 45,
        actions: [{ label: "Nudge Regional", onclick: `atlasCsDashboardQuickAction('po','${escapeAttr(po.id || po.poNumber)}','nudge')` }]
      });
    });
    const taskRows = state.tasks
      .filter(task => rowMatchesCentralDashboardScope(state, widget, task))
      .filter(task => {
        const text = normalizeKey([task.type, task.title, task.status, task.waitingOn].join(" "));
        return (text.includes("po") || text.includes("purchase order")) && (text.includes("regional") || text.includes("approval"));
      })
      .map(task => {
        const row = dashboardTaskRow(task, widget);
        row.fields["PO #"] = task.poNumber || task.sourcePoId || task.id;
        row.fields["Vendor"] = task.vendorName || task.vendor || "";
        row.fields["Amount"] = formatMoney(task.amount) || "$0";
        row.fields["Submitted"] = formatDate(task.createdAt || task.submittedAt || task.dueDate) || "Not dated";
        row.fields["Regional"] = task.assignedRegional || task.regional || "";
        row.fields["Aging Status"] = row.ageDays > 5 ? "Aging" : "Current";
        row.actions = [{ label: "Nudge Regional", onclick: `atlasCsDashboardQuickAction('task','${escapeAttr(task.id)}','nudge')` }];
        return row;
      });
    return [...poRows, ...taskRows];
  }

  function dashboardInvoiceRows(state, widget = {}) {
    return asArray(state.invoices)
      .filter(invoice => rowMatchesCentralDashboardScope(state, widget, invoice))
      .filter(invoice => !["Confirmed", "Approved", "Paid", "Closed", "Rejected"].includes(cleanString(invoice.status || invoice.reviewStatus)))
      .map(invoice => {
        const completed = normalizeDate(invoice.completionDate || invoice.completedAt || invoice.dateCompleted);
        const age = completed ? Math.max(0, -1 * (daysUntil(completed) || 0)) : 0;
        return centralDashboardRow({
          "Vendor": invoice.vendorName || invoice.vendor || "",
          "Vendor Code": invoice.entrataVendorCode || invoice.vendorCode || "",
          "Property / Location": [dashboardPropertyNameForRecord(invoice), invoice.unit || invoice.locationName || invoice.location].filter(Boolean).join(" / "),
          "WO / PO": [invoice.workOrderNumber || invoice.workOrder || invoice.woNumber, invoice.poNumber || invoice.purchaseOrderNumber].filter(Boolean).join(" / "),
          "Amount": formatMoney(invoice.amount || invoice.invoiceAmount) || "$0",
          "Completed": formatDate(completed) || "Not dated",
          "Reviewer": invoice.reviewer || invoice.assignedReviewer || invoice.owner || "Unassigned",
          "Age": `${age} days`
        }, {
          id: invoice.id || invoice.invoiceNumber,
          recordType: "invoice",
          module: "invoices",
          title: invoice.invoiceNumber || invoice.vendorName || "Invoice",
          subtitle: [dashboardPropertyNameForRecord(invoice), invoice.workOrderNumber || invoice.poNumber].filter(Boolean).join(" / "),
          status: invoice.status || invoice.reviewStatus || "Awaiting Confirmation",
          primaryDate: completed,
          ageDays: age,
          priority: age > 3 ? 70 : 40,
          actions: [
            { label: "Confirm Work", onclick: `atlasCsDashboardQuickAction('invoice','${escapeAttr(invoice.id || invoice.invoiceNumber)}','confirm')` },
            { label: "Request Info", onclick: `atlasCsDashboardQuickAction('invoice','${escapeAttr(invoice.id || invoice.invoiceNumber)}','request_info')` },
            { label: "Reject", onclick: `atlasCsDashboardQuickAction('invoice','${escapeAttr(invoice.id || invoice.invoiceNumber)}','reject')` },
            { label: "Infraction", onclick: `atlasCsDashboardQuickAction('invoice','${escapeAttr(invoice.id || invoice.invoiceNumber)}','infraction')` }
          ]
        });
      });
  }

  function dashboardVendorInfractionRows(state, widget = {}) {
    const directRows = asArray(state.vendorInfractions)
      .filter(item => rowMatchesCentralDashboardScope(state, widget, item))
      .filter(item => !["Closed", "Resolved", "Dismissed"].includes(cleanString(item.status)))
      .map(item => centralDashboardRow({
        "Vendor": item.vendorName || item.vendor || "",
        "Vendor Code": item.entrataVendorCode || item.vendorCode || "",
        "Property": dashboardPropertyNameForRecord(item),
        "Category": item.category || item.infractionCategory || "Quality",
        "Severity": item.severity || "Needs Review",
        "Related Record": [item.workOrderNumber || item.workOrder, item.poNumber, item.invoiceNumber].filter(Boolean).join(" / "),
        "Opened": formatDate(item.openedAt || item.createdAt) || "Not dated",
        "Status": item.status || "Open"
      }, {
        id: item.id,
        recordType: "vendorInfraction",
        module: "vendors",
        title: item.vendorName || item.vendor,
        subtitle: dashboardPropertyNameForRecord(item),
        status: item.status || "Open",
        primaryDate: item.openedAt || item.createdAt,
        ageDays: item.openedAt ? Math.max(0, -1 * (daysUntil(item.openedAt) || 0)) : 0,
        priority: normalizeKey(item.severity).includes("high") ? 90 : 60
      }));
    const profileRows = getScopedVendors(state)
      .filter(vendor => rowMatchesCentralDashboardScope(state, widget, { propertyName: asArray(vendor.propertiesServed)[0] || state.ui.propertyId }))
      .filter(vendor => whole(vendor.vendorInfractions) > 0 || normalizeKey(vendor.complianceStatus).includes("issue") || normalizeKey(vendor.complianceStatus).includes("expired") || normalizeKey(vendor.complianceStatus).includes("review"))
      .map(vendor => centralDashboardRow({
        "Vendor": vendor.name,
        "Vendor Code": vendor.entrataVendorCode || "",
        "Property": asArray(vendor.propertiesServed).join(", ") || "Portfolio",
        "Category": normalizeKey(vendor.complianceStatus).includes("compliance") ? "Compliance" : "Quality",
        "Severity": whole(vendor.vendorInfractions) > 2 ? "High" : "Needs Review",
        "Related Record": `${whole(vendor.openWorkOrders)} open work orders`,
        "Opened": "Profile issue",
        "Status": vendor.complianceStatus || "Review Required"
      }, {
        id: vendor.id,
        recordType: "vendor",
        module: "vendors",
        title: vendor.name,
        subtitle: vendor.entrataVendorCode,
        status: vendor.complianceStatus,
        priority: whole(vendor.vendorInfractions) > 2 ? 80 : 55
      }));
    return [...directRows, ...profileRows];
  }

  function buildCentralDashboardWidgetRows(state, widget, employees) {
    const definition = getCentralDashboardWidgetDefinition(widget.widgetKey) || {};
    const buckets = moveOutBucketsForDashboardWidget(state, widget);
    if (widget.widgetKey === "my_work") {
      const taskRows = state.tasks
        .filter(task => rowMatchesCentralDashboardScope(state, widget, task))
        .filter(task => widget.dateRange === "Recently Completed" ? task.status === "Completed" : task.status !== "Completed")
        .filter(task => ownerMatchesCurrentActor(task.owner, task.ownerEmployeeId, task.ownerEmail))
        .map(task => dashboardTaskRow(task, widget));
      const inspectionRows = state.inspections
        .filter(inspection => rowMatchesCentralDashboardScope(state, widget, inspection))
        .filter(inspection => ownerMatchesCurrentActor(inspection.inspectorName, inspection.inspectorEmployeeId, inspection.inspectorEmail))
        .filter(inspection => !isInspectionApprovedStatus(inspection.status))
        .map(inspection => centralDashboardRow({
          "Item": inspection.templateName,
          "Type": "Inspection",
          "Due": formatDate(inspection.inspectionDate) || "Not dated",
          "Status": inspection.status,
          "Follow-Up": inspection.syncStatus || ""
        }, {
          id: inspection.id,
          recordType: "inspection",
          module: "inspections",
          title: inspection.templateName,
          subtitle: `${inspection.propertyName} / ${getInspectionLocationLabel(inspection)}`,
          status: inspection.status,
          dueDate: inspection.inspectionDate,
          priority: daysUntil(inspection.inspectionDate) !== null && daysUntil(inspection.inspectionDate) < 0 ? 70 : 35
        }));
      const morfRows = getActiveScopedMorfs(state)
        .filter(morf => rowMatchesCentralDashboardScope(state, widget, morf))
        .filter(morf => ownerMatchesCurrentActor(morf.processor, morf.processorEmployeeId, morf.processorEmail))
        .map(morf => centralDashboardRow({
          "Item": `MORF - ${morf.residentName}`,
          "Type": "MORF",
          "Due": formatDate(morf.internalDueDate || morf.legalDeadline) || "Not dated",
          "Status": morf.status,
          "Follow-Up": getMorfCompletionMissing(state, morf).slice(0, 2).join(", ") || "Ready"
        }, {
          id: morf.id,
          recordType: "morf",
          module: "morfs",
          title: `MORF - ${morf.residentName}`,
          subtitle: `${morf.propertyName} / Unit ${morf.unit || "n/a"}`,
          status: morf.status,
          dueDate: morf.internalDueDate || morf.legalDeadline,
          priority: daysUntil(morf.legalDeadline) !== null && daysUntil(morf.legalDeadline) <= 2 ? 80 : 45
        }));
      return centralDashboardPrepareRows(state, widget, [...taskRows, ...inspectionRows, ...morfRows]);
    }
    if (widget.widgetKey === "upcoming_move_outs") return centralDashboardPrepareRows(state, widget, buckets.upcoming.map(row => moveOutCaseDashboardRow(state, row, widget, "upcoming")));
    if (widget.widgetKey === "holdover_move_outs") return centralDashboardPrepareRows(state, widget, buckets.holdover.map(row => moveOutCaseDashboardRow(state, row, widget, "holdover")));
    if (widget.widgetKey === "legal_deadline_risk") return centralDashboardPrepareRows(state, widget, buckets.risk.map(row => moveOutCaseDashboardRow(state, row, widget, "risk")));
    if (widget.widgetKey === "move_out_inspections") return centralDashboardPrepareRows(state, widget, buckets.inspections.map(row => moveOutCaseDashboardRow(state, row, widget, "inspections")));
    if (widget.widgetKey === "inspection_approval") return centralDashboardPrepareRows(state, widget, buckets.approval.map(row => moveOutCaseDashboardRow(state, row, widget, "approval")));
    if (widget.widgetKey === "morfs_ready") return centralDashboardPrepareRows(state, widget, buckets.morfReady.map(row => moveOutCaseDashboardRow(state, row, widget, "morfReady")));
    if (widget.widgetKey === "morfs_in_progress") return centralDashboardPrepareRows(state, widget, buckets.morfInProgress.map(row => moveOutCaseDashboardRow(state, row, widget, "morfInProgress")));
    if (widget.widgetKey === "waiting_information") return centralDashboardPrepareRows(state, widget, buckets.waiting.map(row => centralDashboardRow({
      "Resident": row.residentName,
      "Property / Unit": `${row.propertyName} / Unit ${row.unit || "n/a"}`,
      "Needed From": morfRecordForCase(state, row).status?.replace("Waiting on ", "") || "Information",
      "Status": morfRecordForCase(state, row).status || row.workflowStatus,
      "Assigned": row.owner || morfRecordForCase(state, row).processor || "Unassigned",
      "Due": formatDate(morfRecordForCase(state, row).internalDueDate || row.inspectionDate) || "Not dated"
    }, { id: row.id, recordType: "moveOut", module: "moveOuts", filter: "waiting", title: row.residentName, subtitle: row.propertyName, status: row.workflowStatus, dueDate: morfRecordForCase(state, row).internalDueDate || row.inspectionDate, priority: 55 })));
    if (widget.widgetKey === "po_regional_approval" || widget.widgetKey === "po_approval_aging") return centralDashboardPrepareRows(state, widget, dashboardPoRows(state, widget));
    if (widget.widgetKey === "invoice_confirmation") return centralDashboardPrepareRows(state, widget, dashboardInvoiceRows(state, widget));
    if (widget.widgetKey === "vendor_infractions") return centralDashboardPrepareRows(state, widget, dashboardVendorInfractionRows(state, widget));
    if (widget.widgetKey === "sent_to_accounting") return centralDashboardPrepareRows(state, widget, getScopedArchivedMorfs(state).filter(morf => rowMatchesCentralDashboardScope(state, widget, morf)).filter(morf => morf.status === "Sent to Accounting" || morf.archiveStatus === "Sent to Accounting / Open" || morf.accountingHandoffStatus === "Sent to Accounting").map(morf => dashboardMorfRow(state, morf, widget)));
    if (widget.widgetKey === "archived_morfs") return centralDashboardPrepareRows(state, widget, getScopedArchivedMorfs(state).filter(morf => rowMatchesCentralDashboardScope(state, widget, morf)).map(morf => dashboardMorfRow(state, morf, widget)));
    if (widget.widgetKey === "disputes") return centralDashboardPrepareRows(state, widget, getScopedDisputes(state).map(dispute => centralDashboardRow({
      "Resident": dispute.residentName || "",
      "Property / Unit": [dispute.propertyName, dispute.unit ? `Unit ${dispute.unit}` : ""].filter(Boolean).join(" / "),
      "Status": dispute.status,
      "Version": dispute.statementVersion || "",
      "Amount": formatMoney(dispute.currentAmount) || "$0",
      "Opened": formatDate(dispute.openedAt || dispute.createdAt) || "Not dated"
    }, { id: dispute.id, recordType: "dispute", module: "disputes", title: dispute.residentName || dispute.id, subtitle: dispute.status, status: dispute.status, primaryDate: dispute.openedAt || dispute.createdAt, priority: dispute.status === "Dispute Open" ? 70 : 35 })));
    if (widget.widgetKey === "sla_exceptions") {
      const taskRows = state.tasks.filter(task => rowMatchesCentralDashboardScope(state, widget, task)).filter(task => task.status !== "Completed" && daysUntil(task.dueDate) !== null && daysUntil(task.dueDate) < 0).map(task => dashboardTaskRow(task, widget));
      const morfRows = getActiveScopedMorfs(state).filter(morf => rowMatchesCentralDashboardScope(state, widget, morf)).filter(morf => daysUntil(morf.internalDueDate) !== null && daysUntil(morf.internalDueDate) < 0).map(morf => centralDashboardRow({
        "Item": `MORF - ${morf.residentName}`,
        "Property / Unit": `${morf.propertyName} / Unit ${morf.unit || "n/a"}`,
        "Owner": morf.processor || "Unassigned",
        "Due": formatDate(morf.internalDueDate) || "Not dated",
        "Age": dashboardDaysLabel(morf.internalDueDate),
        "Status": morf.status
      }, { id: morf.id, recordType: "morf", module: "morfs", title: morf.residentName, status: morf.status, dueDate: morf.internalDueDate, priority: 90 }));
      return centralDashboardPrepareRows(state, widget, [...taskRows, ...morfRows]);
    }
    if (widget.widgetKey === "task_aging") return centralDashboardPrepareRows(state, widget, state.tasks.filter(task => task.status !== "Completed").filter(task => rowMatchesCentralDashboardScope(state, widget, task)).map(task => dashboardTaskRow(task, widget)));
    if (widget.widgetKey === "morf_pipeline") {
      return WORKFLOW_BUCKET_CONFIGS.filter(([key]) => ["morfReady", "morfInProgress", "waiting", "risk", "sent", "archived"].includes(key)).map(([key, label]) => centralDashboardRow({
        "Stage": label,
        "Count": formatNumber(asArray(buckets[key]).length),
        "Open Records": asArray(buckets[key]).slice(0, 3).map(row => row.residentName).join(", ") || "None"
      }, { id: key, recordType: "bucket", module: key === "archived" ? "archive" : "morfs", filter: key, title: label, status: `${asArray(buckets[key]).length} records`, priority: asArray(buckets[key]).length }));
    }
    if (widget.widgetKey === "renewal_pipeline") {
      const rows = getScopedRenewals(state);
      const grouped = rows.reduce((acc, row) => {
        const key = row.status || "Pending";
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {});
      return Object.entries(grouped).map(([status, count]) => centralDashboardRow({
        "Status": status,
        "Count": formatNumber(count),
        "Period": `${MONTH_LABELS[selectedMonthIdx(state)]} ${selectedYear(state)}`
      }, { id: status, recordType: "bucket", module: "renewals", title: status, status: `${count} records`, priority: count }));
    }
    if (widget.widgetKey === "regional_approval_performance") {
      const rows = dashboardPoRows(state, widget);
      const grouped = rows.reduce((acc, row) => {
        const key = row.fields.Regional || "Unassigned";
        acc[key] = acc[key] || { open: 0, overdue: 0, oldest: 0 };
        acc[key].open += 1;
        acc[key].overdue += row.ageDays > 5 ? 1 : 0;
        acc[key].oldest = Math.max(acc[key].oldest, row.ageDays || 0);
        return acc;
      }, {});
      return Object.entries(grouped).map(([regional, values]) => centralDashboardRow({
        "Regional": regional,
        "Open": formatNumber(values.open),
        "Overdue": formatNumber(values.overdue),
        "Oldest Age": `${values.oldest} days`
      }, { id: regional, recordType: "bucket", module: "tasks", title: regional, status: `${values.open} open`, priority: values.overdue * 10 + values.oldest }));
    }
    if (widget.widgetKey === "vendor_workload") return centralDashboardPrepareRows(state, widget, getScopedVendors(state).map(vendor => centralDashboardRow({
      "Vendor": vendor.name,
      "Vendor Code": vendor.entrataVendorCode || "",
      "Open Work": formatNumber(vendor.openWorkOrders),
      "Completed": formatNumber(vendor.completedWorkOrders),
      "Compliance": vendor.complianceStatus
    }, { id: vendor.id, recordType: "vendor", module: "vendors", title: vendor.name, status: vendor.complianceStatus, priority: whole(vendor.openWorkOrders) })));
    if (widget.widgetKey === "vendor_rankings") return centralDashboardPrepareRows(state, widget, getScopedVendors(state).map(vendor => centralDashboardRow({
      "Vendor": vendor.name,
      "Score": formatNumber(calculateVendorScore(vendor)),
      "Quality": formatNumber(vendor.qualityScore),
      "Reliability": formatNumber(vendor.reliabilityScore),
      "Compliance": formatNumber(vendor.complianceScore),
      "Callbacks": formatNumber(vendor.warrantyCallbacks)
    }, { id: vendor.id, recordType: "vendor", module: "vendors", title: vendor.name, status: vendor.complianceStatus, priority: calculateVendorScore(vendor) })));
    if (widget.widgetKey === "inspection_escalations") {
      return centralDashboardPrepareRows(state, widget, state.inspections.filter(inspection => rowMatchesCentralDashboardScope(state, widget, inspection)).flatMap(inspection => {
        const warnings = [];
        if (getInspectionMissingPhotoChargeCount(inspection)) warnings.push(`${getInspectionMissingPhotoChargeCount(inspection)} documentation warnings`);
        if (inspection.status === "Changes Requested") warnings.push("Changes requested");
        if (inspection.legalRiskEscalation) warnings.push("Legal/risk escalation");
        return warnings.map(warning => centralDashboardRow({
          "Inspection": inspection.templateName,
          "Property / Unit": `${inspection.propertyName} / ${getInspectionLocationLabel(inspection)}`,
          "Inspector": inspection.inspectorName || "Unassigned",
          "Issue": warning,
          "Status": inspection.status
        }, { id: inspection.id, recordType: "inspection", module: "inspections", title: inspection.templateName, status: inspection.status, dueDate: inspection.inspectionDate, priority: 80 }));
      }));
    }
    if (widget.widgetKey === "inspection_repairs") {
      return centralDashboardPrepareRows(state, widget, state.inspections.filter(inspection => rowMatchesCentralDashboardScope(state, widget, inspection)).flatMap(inspection => asArray(inspection.findings).filter(finding => normalizeKey(finding.actionRouting).includes("work") || normalizeKey(finding.actionRouting).includes("repair")).map(finding => centralDashboardRow({
        "Finding": `${finding.room || "Area"} / ${finding.component || "Component"}`,
        "Property / Unit": `${inspection.propertyName} / ${getInspectionLocationLabel(inspection)}`,
        "Assigned": finding.assignedParty || "Unassigned",
        "Status": finding.condition || "Needs Review",
        "Inspection": inspection.templateName
      }, { id: inspection.id, recordType: "inspection", module: "inspections", title: finding.component || "Repair", status: finding.condition, dueDate: inspection.inspectionDate, priority: 50 }))));
    }
    if (widget.widgetKey === "warranty_callbacks") return centralDashboardPrepareRows(state, widget, getScopedVendors(state).filter(vendor => whole(vendor.warrantyCallbacks) || whole(vendor.residentComplaints)).map(vendor => centralDashboardRow({
      "Vendor": vendor.name,
      "Property": asArray(vendor.propertiesServed).join(", ") || "Portfolio",
      "Callbacks": formatNumber(vendor.warrantyCallbacks),
      "Complaints": formatNumber(vendor.residentComplaints),
      "Status": vendor.complianceStatus
    }, { id: vendor.id, recordType: "vendor", module: "vendors", title: vendor.name, status: vendor.complianceStatus, priority: whole(vendor.warrantyCallbacks) + whole(vendor.residentComplaints) })));
    const waitingMap = {
      waiting_property: "property",
      waiting_regional: "regional",
      waiting_vendor: "vendor",
      waiting_accounting: "accounting",
      waiting_resident: "resident"
    };
    if (waitingMap[widget.widgetKey]) {
      const target = waitingMap[widget.widgetKey];
      return centralDashboardPrepareRows(state, widget, state.tasks
        .filter(task => task.status !== "Completed")
        .filter(task => rowMatchesCentralDashboardScope(state, widget, task))
        .filter(task => normalizeKey([task.waitingOn, task.status, task.title, task.type].join(" ")).includes(target))
        .map(task => dashboardTaskRow(task, widget)));
    }
    return centralDashboardPrepareRows(state, widget, []);
  }

  function renderCentralDashboardTable(definition = {}, rows = []) {
    const columns = asArray(definition.columns).length ? definition.columns : Object.keys(asObject(rows[0]?.fields));
    return `<div class="cs-table-wrap cs-dashboard-table-wrap">
      <table class="cs-table cs-dashboard-table">
        <thead><tr>${columns.map(column => `<th>${escapeHtml(column)}</th>`).join("")}<th></th></tr></thead>
        <tbody>${rows.slice(0, 8).map(row => `<tr class="${row.priority >= 80 ? "cs-row-danger" : ""}">
          ${columns.map(column => `<td>${escapeHtml(row.fields?.[column] || "")}</td>`).join("")}
          <td class="right">
            <button type="button" class="cs-btn cs-btn-sm" onclick="atlasCsOpenDashboardRecord('${escapeAttr(row.recordType)}','${escapeAttr(row.id)}','${escapeAttr(row.module)}','${escapeAttr(row.filter)}')">Open</button>
            ${row.actions.map(action => `<button type="button" class="cs-btn cs-btn-sm" onclick="${action.onclick}">${escapeHtml(action.label)}</button>`).join("")}
          </td>
        </tr>`).join("")}</tbody>
      </table>
    </div>`;
  }

  function renderCentralDashboardCards(rows = []) {
    return `<div class="cs-dashboard-card-list">${rows.slice(0, 6).map(row => `<button type="button" class="cs-dashboard-mini-card ${row.priority >= 80 ? "is-priority" : ""}" onclick="atlasCsOpenDashboardRecord('${escapeAttr(row.recordType)}','${escapeAttr(row.id)}','${escapeAttr(row.module)}','${escapeAttr(row.filter)}')">
      <strong>${escapeHtml(row.title)}</strong>
      <span>${escapeHtml(row.subtitle || Object.values(row.fields || {}).slice(0, 2).join(" / "))}</span>
      <em>${escapeHtml(row.status || row.fields?.Status || "")}</em>
    </button>`).join("")}</div>`;
  }

  function renderCentralDashboardKpi(definition = {}, rows = []) {
    const overdue = rows.filter(row => row.dueDate && daysUntil(row.dueDate) !== null && daysUntil(row.dueDate) < 0).length;
    const dueToday = rows.filter(row => row.dueDate && daysUntil(row.dueDate) === 0).length;
    return `<div class="cs-dashboard-kpi-body">
      <strong>${escapeHtml(formatNumber(rows.length))}</strong>
      <span>${escapeHtml(definition.defaultMetric || "Open Items")}</span>
      <div class="cs-chip-row">
        <span class="cs-chip" data-tone="${overdue ? "red" : "green"}">${escapeHtml(formatNumber(overdue))} overdue</span>
        <span class="cs-chip" data-tone="${dueToday ? "amber" : "teal"}">${escapeHtml(formatNumber(dueToday))} due today</span>
      </div>
    </div>`;
  }

  function renderCentralDashboardPipeline(rows = []) {
    const groups = rows.reduce((acc, row) => {
      const key = row.status || row.fields?.Stage || row.fields?.Status || "Open";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    return `<div class="cs-dashboard-pipeline">${Object.entries(groups).map(([label, count]) => `<div class="cs-dashboard-pipeline-stage"><span>${escapeHtml(label)}</span><strong>${escapeHtml(formatNumber(count))}</strong></div>`).join("") || `<div class="cs-dashboard-empty-inline">No active stages.</div>`}</div>`;
  }

  function renderCentralDashboardChart(rows = []) {
    const groups = rows.reduce((acc, row) => {
      const label = row.status || row.fields?.Stage || row.fields?.Status || row.fields?.["Aging Status"] || "Open";
      acc[label] = (acc[label] || 0) + 1;
      return acc;
    }, {});
    const entries = Object.entries(groups).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const max = entries.reduce((largest, [, count]) => Math.max(largest, count), 1);
    return `<div class="cs-dashboard-chart">${entries.map(([label, count]) => {
      const pct = Math.max(8, Math.round((count / max) * 100));
      return `<div class="cs-dashboard-chart-row">
        <span>${escapeHtml(label)}</span>
        <div><i style="width:${pct}%"></i></div>
        <strong>${escapeHtml(formatNumber(count))}</strong>
      </div>`;
    }).join("") || `<div class="cs-dashboard-empty-inline">No chartable records.</div>`}</div>`;
  }

  function centralDashboardWidgetUrgency(definition = {}, rows = []) {
    if (!rows.length) return "green";
    const urgent = rows.some(row => {
      const due = row.dueDate ? daysUntil(row.dueDate) : null;
      return row.priority >= 80 || (due !== null && due < 0);
    });
    if (urgent || definition.priority) return "red";
    const watch = rows.some(row => {
      const due = row.dueDate ? daysUntil(row.dueDate) : null;
      return row.priority >= 60 || due === 0;
    });
    if (watch) return "amber";
    return "teal";
  }

  function renderCentralDashboardWidget(state, widget, employees) {
    const definition = getCentralDashboardWidgetDefinition(widget.widgetKey) || {};
    const rows = buildCentralDashboardWidgetRows(state, widget, employees);
    const visualization = normalizeCentralDashboardVisualization(widget.visualization, definition);
    const urgency = centralDashboardWidgetUrgency(definition, rows);
    const body = !rows.length
      ? `<div class="cs-dashboard-empty-inline">No records are currently in this queue.</div>`
      : visualization === "Cards"
        ? renderCentralDashboardCards(rows)
        : visualization === "KPI"
          ? renderCentralDashboardKpi(definition, rows)
          : visualization === "Pipeline"
            ? renderCentralDashboardPipeline(rows)
            : visualization === "Chart"
              ? renderCentralDashboardChart(rows)
              : renderCentralDashboardTable(definition, rows);
    return `<section class="cs-dashboard-widget is-${escapeAttr(widget.size)} ${definition.priority ? "is-priority" : ""}" data-tone="${escapeAttr(definition.tone || "")}">
      <div class="cs-dashboard-widget-head">
        <div>
          <div class="cs-dashboard-widget-kicker">${escapeHtml(definition.category || "Central Services")}</div>
          <h3>${escapeHtml(definition.label || "Dashboard Widget")}</h3>
        </div>
        <div class="cs-dashboard-widget-count" data-urgency="${escapeAttr(urgency)}" title="${escapeAttr(definition.defaultMetric || "Open records")}">${escapeHtml(formatNumber(rows.length))}</div>
      </div>
      ${!widget.collapsed ? `<p>${escapeHtml(definition.description || "")}</p>` : ""}
      <div class="cs-dashboard-widget-body">${body}</div>
    </section>`;
  }

  function renderCentralDashboardWidgetConfig(state, widget) {
    const definition = getCentralDashboardWidgetDefinition(widget.widgetKey) || {};
    const propertyName = widget.propertyName || (state.ui.propertyId === "all" ? getScopedProperties(state)[0]?.name || "" : state.ui.propertyId);
    return `<div class="cs-dashboard-config">
      <label class="cs-field"><span>Visualization</span><select onchange="atlasCsDashboardUpdateWidget('${escapeAttr(widget.instanceId)}','visualization',this.value)">${genericOptionsHtml(centralDashboardVisualizationOptions(definition), widget.visualization)}</select></label>
      <label class="cs-field"><span>Date Range</span><select onchange="atlasCsDashboardUpdateWidget('${escapeAttr(widget.instanceId)}','dateRange',this.value)">${genericOptionsHtml(CENTRAL_DASHBOARD_DATE_RANGES, widget.dateRange)}</select></label>
      <label class="cs-field"><span>Property Scope</span><select onchange="atlasCsDashboardUpdateWidget('${escapeAttr(widget.instanceId)}','propertyScope',this.value)">${CENTRAL_DASHBOARD_SCOPE_OPTIONS.map(([key, label]) => `<option value="${escapeAttr(key)}" ${widget.propertyScope === key ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}</select></label>
      ${widget.propertyScope === "single" ? `<label class="cs-field"><span>Property</span><select onchange="atlasCsDashboardUpdateWidget('${escapeAttr(widget.instanceId)}','propertyName',this.value)">${propertyOptionsHtml(propertyName, false)}</select></label>` : ""}
      <label class="cs-field"><span>Portfolio Scope</span><select onchange="atlasCsDashboardUpdateWidget('${escapeAttr(widget.instanceId)}','portfolioScope',this.value)">${CENTRAL_DASHBOARD_PORTFOLIO_SCOPE_OPTIONS.map(([key, label]) => `<option value="${escapeAttr(key)}" ${widget.portfolioScope === key ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}</select></label>
      <label class="cs-field"><span>Workflow Filter</span><input value="${escapeAttr(widget.workflowFilter || widget.filter || "")}" onchange="atlasCsDashboardUpdateWidget('${escapeAttr(widget.instanceId)}','workflowFilter',this.value)" placeholder="Optional status or queue filter"></label>
      <label class="cs-field"><span>Aging Filter</span><select onchange="atlasCsDashboardUpdateWidget('${escapeAttr(widget.instanceId)}','agingFilter',this.value)">${genericOptionsHtml(CENTRAL_DASHBOARD_AGING_FILTERS, widget.agingFilter)}</select></label>
      <label class="cs-field"><span>Sort Order</span><select onchange="atlasCsDashboardUpdateWidget('${escapeAttr(widget.instanceId)}','sortOrder',this.value)">${genericOptionsHtml(CENTRAL_DASHBOARD_SORT_OPTIONS, widget.sortOrder)}</select></label>
    </div>`;
  }

  function renderCentralDashboardWidgetLibrary(state) {
    const prefs = getCentralDashboardPreferences(state);
    const activeCounts = asArray(prefs.widgets).reduce((acc, widget) => {
      acc[widget.widgetKey] = (acc[widget.widgetKey] || 0) + 1;
      return acc;
    }, {});
    return `<div class="cs-dashboard-library">
      <div class="cs-panel-head">
        <div>
          <div class="cs-panel-title">Add Widget</div>
          <div class="cs-panel-sub">Default and optional Central Services widgets remain available individually.</div>
        </div>
      </div>
      <div class="cs-dashboard-library-grid">
        ${CENTRAL_DASHBOARD_WIDGETS.map(widget => `<div class="cs-dashboard-library-card">
          <div class="cs-dashboard-widget-kicker">${escapeHtml(widget.optional ? "Optional" : "Default")} / ${escapeHtml(widget.category)}</div>
          <strong>${escapeHtml(widget.label)}</strong>
          <span>${escapeHtml(widget.description)}</span>
          <div class="cs-chip-row">
            <span class="cs-chip">${escapeHtml(centralDashboardVisualizationOptions(widget).join(" / "))}</span>
            ${activeCounts[widget.key] ? `<span class="cs-chip" data-tone="green">${escapeHtml(activeCounts[widget.key])} active</span>` : ""}
          </div>
          <button type="button" class="cs-btn cs-btn-sm" onclick="atlasCsDashboardAddWidget('${escapeAttr(widget.key)}')">${icon("plus")} Add Widget</button>
        </div>`).join("")}
      </div>
    </div>`;
  }

  function renderCentralServicesDashboard(state, employees) {
    const prefs = getCentralDashboardPreferences(state);
    const widgets = getCentralDashboardWidgets(state);
    const kpis = getKpis(state, employees);
    return `<div class="cs-dashboard-builder">
      <div class="cs-dashboard-command-strip">
        <div>
          <div class="cs-panel-title">Central Services Command Center</div>
          <div class="cs-panel-sub">Default view: My Work, exceptions, move-outs, MORFs, Regional approvals, invoices, vendors, and Accounting handoffs. Each user can personalize the layout from Settings without changing shared records.</div>
        </div>
        <div class="cs-command-actions">
          <button type="button" class="cs-btn cs-btn-sm" onclick="atlasCsSetModule('settings');setTimeout(()=>atlasCsScrollToDashboardPreferences(),0)">${icon("sliders-horizontal")} Dashboard Preferences</button>
        </div>
      </div>
      <div class="cs-dashboard-signal-row">
        <span>${escapeHtml(formatNumber(kpis.overdueTasks))} overdue tasks</span>
        <span>${escapeHtml(formatNumber(kpis.legalDeadlineRisk))} legal deadline risks</span>
        <span>${escapeHtml(formatNumber(kpis.holdovers))} holdovers</span>
        <span>${escapeHtml(formatNumber(kpis.inspectionApprovals))} inspections awaiting approval</span>
        <span>${escapeHtml(formatNumber(kpis.sentToAccounting))} sent to Accounting</span>
      </div>
      <div class="cs-dashboard-widget-grid">${widgets.map(widget => renderCentralDashboardWidget(state, widget, employees)).join("")}</div>
    </div>`;
  }

  function renderBucketPreview(caseRecord) {
    const due = daysUntil(caseRecord.inspectionDate || caseRecord.scheduledMoveOutDate);
    const dateLabel = formatDate(caseRecord.inspectionDate || caseRecord.scheduledMoveOutDate) || "No date";
    const dueLabel = due === null ? "Timing pending" : due < 0 ? `${Math.abs(due)} days overdue` : due === 0 ? "Due today" : `${due} days`;
    return `<button type="button" class="cs-bucket-record" data-id="${escapeAttr(caseRecord.id)}" onclick="atlasCsSelectMoveOut(this.dataset.id)">
      <strong>${escapeHtml(caseRecord.residentName || "Resident")}</strong>
      <span>${escapeHtml(caseRecord.propertyName)} / Unit ${escapeHtml(caseRecord.unit || "n/a")}</span>
      <em>${escapeHtml(dateLabel)} - ${escapeHtml(dueLabel)}</em>
    </button>`;
  }

  function renderWorkflowBucketBoard(state) {
    const buckets = getMoveOutWorkflowBuckets(state);
    return `<div class="cs-workflow-bucket-grid">
      ${WORKFLOW_BUCKET_CONFIGS.map(([key, title, copy, iconName, tone]) => {
        const records = buckets[key] || [];
        const targetModule = key === "archived" ? "archive" : key === "morfReady" || key === "morfInProgress" ? "morfs" : "moveOuts";
        return `<div class="cs-workflow-bucket" data-tone="${escapeAttr(tone)}">
          <button type="button" class="cs-workflow-bucket-head" onclick="atlasCsDrill('${escapeAttr(targetModule)}','${escapeAttr(key)}')">
            <span>${icon(iconName)}</span>
            <strong>${escapeHtml(title)}</strong>
            <em>${escapeHtml(formatNumber(records.length))}</em>
          </button>
          <p>${escapeHtml(copy)}</p>
          ${records.length ? `<div class="cs-bucket-record-list">${records.slice(0, 3).map(renderBucketPreview).join("")}</div>` : `<div class="cs-bucket-empty">No records in this bucket.</div>`}
        </div>`;
      }).join("")}
    </div>`;
  }

  function renderOverview(state, employees) {
    return renderCentralServicesDashboard(state, employees);
  }

  function renderPropertySummaryTable(state) {
    const rows = getPropertyMonthSummaries(state);
    if (!rows.length) {
      return `<div class="cs-empty"><div><strong>No ATLAS properties are available yet.</strong><br>Once properties exist in ATLAS, Central Services will compile them here.</div></div>`;
    }
    return `<div class="cs-table-wrap">
      <table class="cs-table">
        <thead>
          <tr><th>Property</th><th>Region</th><th class="right">Units</th><th class="right">Expiring</th><th class="right">Signed</th><th class="right">NTV</th><th class="right">Transfer</th><th class="right">Pending</th><th class="right">Move-Outs</th><th>Source</th><th></th></tr>
        </thead>
        <tbody>
          ${rows.map(row => `<tr>
            <td><div class="cs-name-cell"><strong>${escapeHtml(row.propertyName)}</strong><span>${escapeHtml(row.market || row.propertyType || (row.active ? "Active" : "Inactive"))}</span></div></td>
            <td>${escapeHtml(row.region || "Not grouped")}</td>
            <td class="right">${formatNumber(row.units)}</td>
            <td class="right">${formatNumber(row.expirations)}</td>
            <td class="right">${formatNumber(row.signed)}</td>
            <td class="right">${formatNumber(row.ntv)}</td>
            <td class="right">${formatNumber(row.transfers)}</td>
            <td class="right">${formatNumber(row.undecided)}</td>
            <td class="right">${formatNumber(row.moveOuts)}</td>
            <td><span class="cs-chip ${row.hasDetailed ? "is-strong" : ""}">${escapeHtml(row.sourceLabel)}</span></td>
            <td class="right"><button type="button" class="cs-btn cs-btn-sm" data-property="${escapeAttr(row.propertyName)}" onclick="atlasCsOpenPropertyRenewals(this.dataset.property)">Open</button></td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
  }

  function renderImportPanel(state) {
    const selected = state.ui.propertyId === "all" ? "" : state.ui.propertyId;
    return `<div class="cs-panel">
      <div class="cs-panel-head">
        <div>
          <div class="cs-panel-title">Upload Renewal Report</div>
          <div class="cs-panel-sub">Use an actual Entrata renewal export. Imported resident rows become Central Services workflow records and can feed ATLAS renewal summaries.</div>
        </div>
      </div>
      <div class="cs-panel-body">
        <div class="cs-import-flow" style="margin-bottom:12px">
          ${["Validate file", "Map columns", "Deduplicate records", "Create move-out lifecycle records", "Write ATLAS summary"].map((step, idx) => `<div class="cs-import-step"><strong>${idx + 1}. ${escapeHtml(step)}</strong><span>Runs from the uploaded report, not seeded data.</span></div>`).join("")}
        </div>
        <div class="cs-control-grid" style="margin-bottom:12px">
          <label class="cs-field">
            <span>Import Property</span>
            <select id="atlas-cs-renewal-property">${propertyOptionsHtml(selected, false)}</select>
          </label>
          <label class="cs-field">
            <span>Import Month</span>
            <select id="atlas-cs-renewal-month">${monthOptionsHtml(selectedMonthIdx(state))}</select>
          </label>
          <label class="cs-field">
            <span>Import Year</span>
            <input id="atlas-cs-renewal-year" type="number" min="2020" max="2035" value="${escapeAttr(selectedYear(state))}">
          </label>
          <label class="cs-dropzone" style="grid-column:span 3">
            ${icon("upload-simple")}
            <strong>Choose XLSX or CSV renewal report</strong>
            <span>Rows must include at least resident, unit, and lease expiration for resident-level tracking.</span>
            <input type="file" accept=".xlsx,.xls,.xlsm,.csv" onchange="atlasCsHandleRenewalUpload(this)">
          </label>
        </div>
      </div>
    </div>`;
  }

  function renderRenewalTable(state, employees) {
    const rows = getScopedRenewals(state);
    if (!rows.length) {
      return `<div class="cs-empty"><div><strong>No resident-level renewal rows in Central Services yet.</strong><br>Upload the actual Entrata renewal report for a property and month to unlock resident drilldowns, ownership, status changes, and NTV workflow creation.</div></div>`;
    }
    return `<div class="cs-table-wrap">
      <table class="cs-table">
        <thead><tr><th>Resident</th><th>Property / Unit</th><th>Expiration</th><th>Status</th><th>Owner</th><th>Next Action</th><th>Due</th><th></th></tr></thead>
        <tbody>
          ${rows.map(row => `<tr class="${state.ui.selectedRenewalId === row.id ? "is-selected" : ""}">
            <td><div class="cs-name-cell"><strong>${escapeHtml(row.residentName)}</strong><span>${escapeHtml(row.email || row.phone || "Resident contact not imported")}</span></div></td>
            <td><div class="cs-name-cell"><strong>${escapeHtml(row.propertyName)}</strong><span>Unit ${escapeHtml(row.unit || "n/a")} ${row.unitType ? `- ${escapeHtml(row.unitType)}` : ""}</span></div></td>
            <td>${escapeHtml(formatDate(row.expirationDate) || "Not imported")}</td>
            <td><select data-id="${escapeAttr(row.id)}" onchange="atlasCsUpdateRenewalStatus(this.dataset.id,this.value)">${RENEWAL_STATUS_OPTIONS.map(status => `<option value="${escapeAttr(status)}" ${status === row.status ? "selected" : ""}>${escapeHtml(status)}</option>`).join("")}</select></td>
            <td><select data-id="${escapeAttr(row.id)}" onchange="atlasCsUpdateRenewalField(this.dataset.id,'owner',this.value)">${ownerOptionsHtml(employees, row.owner || "Unassigned")}</select></td>
            <td><input value="${escapeAttr(row.nextAction || "")}" placeholder="Next action" data-id="${escapeAttr(row.id)}" onchange="atlasCsUpdateRenewalField(this.dataset.id,'nextAction',this.value)"></td>
            <td><input type="date" value="${escapeAttr(row.dueDate || "")}" data-id="${escapeAttr(row.id)}" onchange="atlasCsUpdateRenewalField(this.dataset.id,'dueDate',this.value)"></td>
            <td class="right">
              <button type="button" class="cs-btn cs-btn-sm" data-id="${escapeAttr(row.id)}" onclick="atlasCsSelectRenewal(this.dataset.id)">Open</button>
              <button type="button" class="cs-btn cs-btn-sm" data-id="${escapeAttr(row.id)}" onclick="atlasCsCreateMoveOutFromRenewal(this.dataset.id)">Move-Out</button>
            </td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
  }

  function renderRenewalDetail(state) {
    const rows = getScopedRenewals(state);
    const row = rows.find(item => item.id === state.ui.selectedRenewalId) || rows[0];
    if (!row) {
      return `<div class="cs-detail-panel"><div class="cs-detail-title"><h3>Renewal Detail</h3></div><div class="cs-alert">Open an imported renewal row to see resident-level details.</div></div>`;
    }
    const fields = [
      ["Resident", row.residentName],
      ["Phone", row.phone],
      ["Email", row.email],
      ["Property", row.propertyName],
      ["Unit", row.unit],
      ["Unit Type", row.unitType],
      ["Expiration", formatDate(row.expirationDate)],
      ["Deposit Held", formatMoney(row.depositHeld)],
      ["Current Rate", formatMoney(row.currentRate)],
      ["Market Rate", formatMoney(row.marketRate)],
      ["Budget Rate", formatMoney(row.budgetRate)],
      ["Recommended Offer", formatMoney(row.recommendedOffer)],
      ["Signed Offer", formatMoney(row.signedOffer)],
      ["90-Day", formatDate(row.notice90Date)],
      ["60-Day", formatDate(row.notice60Date)],
      ["30-Day", formatDate(row.notice30Date)],
      ["Occupancy", row.occupancyPosition],
      ["Signed Growth", row.signedRentGrowth]
    ];
    return `<div class="cs-detail-panel">
      <div class="cs-detail-title">
        <div>
          <h3>${escapeHtml(row.residentName)}</h3>
          <div class="cs-detail-meta">${escapeHtml(row.propertyName)} - Unit ${escapeHtml(row.unit || "n/a")}</div>
        </div>
        ${statusPill(row.status)}
      </div>
      <div class="cs-section-grid">
        ${fields.map(([label, value]) => `<div class="cs-data-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || "Not imported")}</strong></div>`).join("")}
      </div>
      <label class="cs-field">
        <span>Notes</span>
        <textarea data-id="${escapeAttr(row.id)}" onchange="atlasCsUpdateRenewalField(this.dataset.id,'notes',this.value)">${escapeHtml(row.notes || "")}</textarea>
      </label>
      <div class="cs-chip-row">
        <span class="cs-chip is-strong">Source: ${escapeHtml(row.sourceFileName || "Central Services import")}</span>
        <span class="cs-chip">Persistent ID: ${escapeHtml(row.id)}</span>
      </div>
    </div>`;
  }

  function renderRenewals(state, employees) {
    return `<div class="cs-two-col">
      <div style="display:grid;gap:14px">
        ${renderImportPanel(state)}
        <div class="cs-panel">
          <div class="cs-panel-head">
            <div>
              <div class="cs-panel-title">Property Month Summary</div>
              <div class="cs-panel-sub">Uses imported Central Services rows where available; otherwise uses ATLAS monthly renewal summaries.</div>
            </div>
          </div>
          <div class="cs-panel-body">${renderPropertySummaryTable(state)}</div>
        </div>
        <div class="cs-panel">
          <div class="cs-panel-head">
            <div>
              <div class="cs-panel-title">Resident-Level Tracker</div>
              <div class="cs-panel-sub">Only populated by actual uploaded renewal reports.</div>
            </div>
          </div>
          <div class="cs-panel-body">${renderRenewalTable(state, employees)}</div>
        </div>
      </div>
      ${renderRenewalDetail(state)}
    </div>`;
  }

  function workflowStepClass(caseRecord, step, steps = MOVE_OUT_STEPS) {
    const activeIndex = Math.max(0, steps.indexOf(caseRecord.workflowStatus || "On Notice"));
    const stepIndex = steps.indexOf(step);
    if (stepIndex < activeIndex) return "is-done";
    if (stepIndex === activeIndex) return "is-active";
    return "";
  }

  function renderMoveOutWorkflow(caseRecord) {
    const steps = isHoldOverCase(caseRecord) ? HOLD_OVER_STEPS : MOVE_OUT_STEPS;
    return `<div class="cs-workflow">
      ${steps.map((step, idx) => `<div class="cs-step ${workflowStepClass(caseRecord, step, steps)}"><span class="cs-step-index">${idx + 1}</span><strong>${escapeHtml(step)}</strong><span>${step === caseRecord.workflowStatus ? "Current stage" : "Workflow stage"}</span></div>`).join("")}
    </div>`;
  }

  function getMoveOutsForCurrentFilter(state) {
    const filter = cleanString(state.ui.workflowFilter || "all");
    if (!filter || filter === "all") return getScopedMoveOuts(state);
    const buckets = getMoveOutWorkflowBuckets(state);
    return asArray(buckets[filter]);
  }

  function renderManualMoveOutPanel(state, employees) {
    const selected = state.ui.propertyId === "all" ? "" : state.ui.propertyId;
    return `<div class="cs-panel">
      <div class="cs-panel-head">
        <div>
          <div class="cs-panel-title">Manual Move-Out Workflow Creation</div>
          <div class="cs-panel-sub">Use this when notice is received outside the Renewal Tracker, a resident was missed, or a property submits an off-cycle move-out.</div>
        </div>
      </div>
      <div class="cs-panel-body">
        <div class="cs-control-grid">
          <label class="cs-field"><span>Property</span><select id="atlas-cs-manual-property">${propertyOptionsHtml(selected, false)}</select></label>
          <label class="cs-field"><span>Resident</span><input id="atlas-cs-manual-resident" placeholder="Resident name"></label>
          <label class="cs-field"><span>Unit</span><input id="atlas-cs-manual-unit" placeholder="Apartment"></label>
          <label class="cs-field"><span>Resident ID</span><input id="atlas-cs-manual-resident-id" placeholder="Optional"></label>
          <label class="cs-field"><span>Lease ID</span><input id="atlas-cs-manual-lease-id" placeholder="Optional"></label>
          <label class="cs-field"><span>Move-In Date</span><input id="atlas-cs-manual-move-in" type="date"></label>
          <label class="cs-field"><span>Lease Expiration</span><input id="atlas-cs-manual-expiration" type="date"></label>
          <label class="cs-field"><span>Notice Date</span><input id="atlas-cs-manual-notice" type="date" value="${escapeAttr(TODAY_ISO)}"></label>
          <label class="cs-field"><span>Scheduled Move-Out</span><input id="atlas-cs-manual-scheduled" type="date"></label>
          <label class="cs-field"><span>Phone</span><input id="atlas-cs-manual-phone" placeholder="Phone"></label>
          <label class="cs-field"><span>Email</span><input id="atlas-cs-manual-email" type="email" placeholder="Resident email"></label>
          <label class="cs-field"><span>Deposit</span><input id="atlas-cs-manual-deposit" type="number" min="0" value="0"></label>
          <label class="cs-field"><span>Assigned Regional</span><input id="atlas-cs-manual-regional" placeholder="Regional"></label>
          <label class="cs-field"><span>CS Owner</span><select id="atlas-cs-manual-owner">${ownerOptionsHtml(employees, defaultOwner(employees))}</select></label>
          <label class="cs-field" style="grid-column:span 2"><span>Forwarding Address</span><input id="atlas-cs-manual-forwarding" placeholder="Optional"></label>
          <label class="cs-field" style="grid-column:span 4"><span>Notes</span><textarea id="atlas-cs-manual-notes" placeholder="Notice source, correction reason, or property note"></textarea></label>
          <div class="cs-field"><span>&nbsp;</span><button type="button" class="cs-btn cs-btn-primary" onclick="atlasCsCreateManualMoveOut()">${icon("plus")} Create Lifecycle Record</button></div>
        </div>
      </div>
    </div>`;
  }

  function renderPotentialMoveOutUpdates(state) {
    const rows = asArray(state.potentialMoveOutUpdates).filter(row => row.status !== "Dismissed" && row.status !== "Applied");
    if (!rows.length) return "";
    return `<div class="cs-panel">
      <div class="cs-panel-head">
        <div>
          <div class="cs-panel-title">Potential Record Update</div>
          <div class="cs-panel-sub">Imported or manually entered data matched an active lifecycle record but conflicts with protected workflow data. Review before applying anything.</div>
        </div>
      </div>
      <div class="cs-panel-body">
        <div class="cs-table-wrap">
          <table class="cs-table">
            <thead><tr><th>Resident</th><th>Property / Unit</th><th>Incoming Source</th><th>Conflicting Fields</th><th>Status</th><th></th></tr></thead>
            <tbody>
              ${rows.map(row => `<tr>
                <td>${escapeHtml(row.residentName)}</td>
                <td>${escapeHtml(row.propertyName)} / Unit ${escapeHtml(row.unit || "n/a")}</td>
                <td>${escapeHtml(row.sourceLabel || row.source || "Workflow update")}</td>
                <td>${escapeHtml(asArray(row.conflicts).map(item => `${item.label}: ${item.existing || "blank"} -> ${item.incoming || "blank"}`).join(" | "))}</td>
                <td>${statusPill(row.status || "Review Required")}</td>
                <td class="right">
                  <button type="button" class="cs-btn cs-btn-sm" data-id="${escapeAttr(row.id)}" onclick="atlasCsOpenPotentialMoveOutUpdate(this.dataset.id)">Review</button>
                  <button type="button" class="cs-btn cs-btn-sm" data-id="${escapeAttr(row.id)}" onclick="atlasCsApplyPotentialMoveOutUpdate(this.dataset.id)">Apply</button>
                  <button type="button" class="cs-btn cs-btn-sm cs-btn-danger" data-id="${escapeAttr(row.id)}" onclick="atlasCsDismissPotentialMoveOutUpdate(this.dataset.id)">Dismiss</button>
                </td>
              </tr>`).join("")}
            </tbody>
          </table>
        </div>
      </div>
    </div>`;
  }

  function renderMoveOutTable(state) {
    const cases = getMoveOutsForCurrentFilter(state);
    const filter = cleanString(state.ui.workflowFilter || "all");
    if (!cases.length) {
      return `<div class="cs-empty"><div><strong>No resident-level move-out cases in this view.</strong><br>Renewal Tracker NTV rows and manual entries create persistent lifecycle records. Change the bucket filter or upload a report to populate this list.</div></div>`;
    }
    return `<div class="cs-table-wrap">
      <table class="cs-table">
        <thead><tr><th>Resident</th><th>Property / Unit</th><th>Scheduled Move-Out</th><th>Days</th><th>Possession</th><th>Inspection</th><th>MORF</th><th>Owner</th><th></th></tr></thead>
        <tbody>
          ${cases.map(item => {
            const morf = getMorfForCase(state, item.id);
            const scheduledDelta = daysUntil(item.scheduledMoveOutDate);
            return `<tr class="${state.ui.selectedMoveOutId === item.id ? "is-selected" : ""} ${isHoldOverCase(item) ? "cs-row-danger" : ""}">
            <td><div class="cs-name-cell"><strong>${escapeHtml(item.residentName)}</strong><span>${escapeHtml(item.email || item.phone || "Resident contact not imported")}</span></div></td>
            <td><div class="cs-name-cell"><strong>${escapeHtml(item.propertyName)}</strong><span>Unit ${escapeHtml(item.unit || "n/a")}</span></div></td>
            <td>${escapeHtml(formatDate(item.scheduledMoveOutDate) || "Needed from MOG")}</td>
            <td>${scheduledDelta === null ? "Pending" : scheduledDelta < 0 ? `${escapeHtml(Math.abs(scheduledDelta))} overdue` : scheduledDelta === 0 ? "Today" : `${escapeHtml(scheduledDelta)} days`}</td>
            <td>${statusPill(item.possessionStatus || (getActualPossessionDate(item) ? "Returned" : "Not Confirmed"))}</td>
            <td>${statusPill(item.inspectionStatus || "Not Scheduled")}</td>
            <td>${statusPill(morf?.status || item.morfSodaStatus || "Not Started")}</td>
            <td>${escapeHtml(item.owner || "Unassigned")}</td>
            <td class="right"><button type="button" class="cs-btn cs-btn-sm" data-id="${escapeAttr(item.id)}" onclick="atlasCsSelectMoveOut(this.dataset.id)">Open</button></td>
          </tr>`;
          }).join("")}
        </tbody>
      </table>
      ${filter !== "all" ? `<div class="cs-table-note">Showing bucket: ${escapeHtml(WORKFLOW_BUCKET_CONFIGS.find(([key]) => key === filter)?.[1] || filter)}</div>` : ""}
    </div>`;
  }

  function renderMoveOutDetail(state) {
    const cases = getScopedMoveOuts(state);
    const item = cases.find(row => row.id === state.ui.selectedMoveOutId) || cases[0];
    if (!item) {
      return `<div class="cs-detail-panel"><div class="cs-detail-title"><h3>Move-Out Detail</h3></div><div class="cs-alert">Open a real move-out case to run MOG, inspection, MORF/SODA, and accounting steps.</div></div>`;
    }
    const morf = getMorfForCase(state, item.id);
    const inspection = getMoveOutInspectionForCase(state, item);
    const actualPossession = getActualPossessionDate(item);
    const internalMorfDue = morf?.internalDueDate || calculateInternalMorfDueDate(state, item);
    const legalDeadline = morf?.legalDeadline || calculateLegalDeadlineForCase(state, item);
    const defaultInspectionDate = calculateDefaultInspectionDate(state, item);
    const effectiveInspectionDate = item.inspectionDate || defaultInspectionDate;
    const daysPastMoveOut = item.scheduledMoveOutDate && !actualPossession ? daysBetween(item.scheduledMoveOutDate, TODAY_ISO) : null;
    const communications = asArray(item.communications);
    const memos = asArray(item.memos);
    const fields = [
      ["Resident", item.residentName],
      ["Resident ID", item.residentId],
      ["Lease ID", item.leaseId],
      ["Phone", item.phone],
      ["Email", item.email],
      ["Property", item.propertyName],
      ["Unit", item.unit],
      ["Move-In", formatDate(item.moveInDate)],
      ["Lease Expiration", formatDate(item.leaseExpiration)],
      ["Scheduled Move-Out", formatDate(item.scheduledMoveOutDate)],
      ["Actual Possession Returned", formatDate(actualPossession)],
      ["Notice Date", formatDate(item.ntvReceivedDate || item.noticeDate)],
      ["Days Past Due", daysPastMoveOut && daysPastMoveOut > 0 ? `${daysPastMoveOut} days` : ""],
      ["Deposit Held", formatMoney(item.depositHeld)],
      ["Forwarding Address", item.forwardingAddress],
      ["Inspection Date", formatDate(effectiveInspectionDate)],
      ["Inspection ID", inspection?.id],
      ["Inspection Approval", item.inspectionApprovalStatus],
      ["Internal MORF Due", formatDate(internalMorfDue)],
      ["State Legal Deadline", formatDate(legalDeadline) || "Legal config required"],
      ["MORF ID", morf?.id],
      ["Accounting Contact", item.accountingContactName || item.accountingContactEmail]
    ];
    return `<div class="cs-detail-panel">
      <div class="cs-detail-title">
        <div>
          <h3>${escapeHtml(item.residentName)}</h3>
          <div class="cs-detail-meta">${escapeHtml(item.propertyName)} - Unit ${escapeHtml(item.unit || "n/a")} - ${escapeHtml(item.lifecycleRecordType || "Move-Out Lifecycle Record")}</div>
        </div>
        ${statusPill(item.workflowStatus || "On Notice")}
      </div>
      ${isHoldOverCase(item) ? `<div class="cs-alert is-danger"><strong>Hold Over / Past Due Move Out.</strong> This resident was expected to return possession and has not been confirmed. The inspection remains on hold until actual possession is entered.</div>` : ""}
      ${renderMoveOutWorkflow(item)}
      <div class="cs-section-grid">
        ${fields.map(([label, value]) => `<div class="cs-data-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || "Not captured")}</strong></div>`).join("")}
      </div>
      <div class="cs-field-cluster">
        <div class="cs-field-cluster-title">Hold Over Actions</div>
        <div class="cs-holdover-actions">
          <button type="button" class="cs-btn cs-btn-sm" data-id="${escapeAttr(item.id)}" onclick="atlasCsCreateResidentNotification(this.dataset.id)">${icon("envelope-simple")} Resident Notification</button>
          <button type="button" class="cs-btn cs-btn-sm" data-id="${escapeAttr(item.id)}" onclick="atlasCsAdjustHoldoverDates(this.dataset.id)">${icon("calendar-plus")} Adjust Dates</button>
          <button type="button" class="cs-btn cs-btn-sm" data-id="${escapeAttr(item.id)}" onclick="atlasCsAddLifecycleMemo(this.dataset.id)">${icon("note-pencil")} Add Lifecycle Memo</button>
          <button type="button" class="cs-btn cs-btn-sm cs-btn-primary" data-id="${escapeAttr(item.id)}" onclick="atlasCsConfirmPossession(this.dataset.id)">${icon("key")} Possession Confirmed</button>
        </div>
      </div>
      <div class="cs-chip-row">
        <button type="button" class="cs-btn cs-btn-sm" data-id="${escapeAttr(item.id)}" onclick="atlasCsSendMog(this.dataset.id)">Send MOG</button>
        <button type="button" class="cs-btn cs-btn-sm" data-id="${escapeAttr(item.id)}" onclick="atlasCsCompleteMog(this.dataset.id)">Complete MOG</button>
        <button type="button" class="cs-btn cs-btn-sm" data-id="${escapeAttr(item.id)}" onclick="atlasCsScheduleInspection(this.dataset.id)">Schedule Inspection</button>
        <button type="button" class="cs-btn cs-btn-sm" data-id="${escapeAttr(item.id)}" onclick="atlasCsCreateInspectionFromMoveOut(this.dataset.id)">${inspection ? "Open Inspection" : "Create Field Inspection"}</button>
        <button type="button" class="cs-btn cs-btn-sm" data-id="${escapeAttr(item.id)}" onclick="atlasCsCompleteInspection(this.dataset.id)">Mark Inspection Complete</button>
        <button type="button" class="cs-btn cs-btn-sm" data-id="${escapeAttr(item.id)}" onclick="atlasCsConfirmPossession(this.dataset.id)">Actual Possession Returned</button>
        <button type="button" class="cs-btn cs-btn-sm" data-id="${escapeAttr(item.id)}" onclick="atlasCsOpenMorfForCase(this.dataset.id)">Open MORF</button>
        <button type="button" class="cs-btn cs-btn-sm" data-id="${escapeAttr(item.id)}" onclick="atlasCsSendToAccounting(this.dataset.id)">Send to Accounting</button>
        <button type="button" class="cs-btn cs-btn-sm" data-id="${escapeAttr(item.id)}" onclick="atlasCsDownloadCasePacket(this.dataset.id)">Export Case</button>
      </div>
      <div class="cs-control-grid">
        <label class="cs-field"><span>Scheduled Move-Out Date</span><input type="date" value="${escapeAttr(item.scheduledMoveOutDate || "")}" data-id="${escapeAttr(item.id)}" onchange="atlasCsUpdateMoveOutField(this.dataset.id,'scheduledMoveOutDate',this.value)"></label>
        <label class="cs-field"><span>Scheduled Inspection Date</span><input type="date" value="${escapeAttr(effectiveInspectionDate || "")}" data-id="${escapeAttr(item.id)}" onchange="atlasCsUpdateMoveOutField(this.dataset.id,'inspectionDate',this.value)"></label>
        <label class="cs-field" style="grid-column:span 4"><span>Forwarding Address</span><input value="${escapeAttr(item.forwardingAddress || "")}" data-id="${escapeAttr(item.id)}" onchange="atlasCsUpdateMoveOutField(this.dataset.id,'forwardingAddress',this.value)"></label>
      </div>
      <label class="cs-field">
        <span>Case Notes</span>
        <textarea data-id="${escapeAttr(item.id)}" onchange="atlasCsUpdateMoveOutField(this.dataset.id,'notes',this.value)">${escapeHtml(item.notes || "")}</textarea>
      </label>
      <div class="cs-field-cluster">
        <div class="cs-field-cluster-title">Resident Communications</div>
        ${communications.length ? renderMiniTimeline(communications.map(row => ({ at: row.createdAt, label: `${row.type || "Draft"} - ${row.status || "Draft"} - ${row.emailTo || row.smsTo || "recipient pending"}` }))) : `<div class="cs-alert">No resident notification drafts have been created for this lifecycle yet.</div>`}
      </div>
      <div class="cs-field-cluster">
        <div class="cs-field-cluster-title">Lifecycle Memos</div>
        ${memos.length ? renderMiniTimeline(memos.map(row => ({ at: row.at, label: `${row.user || "Central Services"} - ${row.memo}` }))) : `<div class="cs-alert">No lifecycle memos have been added yet.</div>`}
      </div>
      <div class="cs-field-cluster">
        <div class="cs-field-cluster-title">Permanent Activity History</div>
        ${renderMiniTimeline(item.activity)}
      </div>
    </div>`;
  }

  function renderMoveOuts(state, employees) {
    return `<div class="cs-two-col">
      <div style="display:grid;gap:14px">
        ${renderManualMoveOutPanel(state, employees)}
        ${renderPotentialMoveOutUpdates(state)}
        <div class="cs-panel">
          <div class="cs-panel-head">
            <div>
              <div class="cs-panel-title">Portfolio Workload Buckets</div>
              <div class="cs-panel-sub">Open a bucket to filter the lifecycle records below.</div>
            </div>
          </div>
          <div class="cs-panel-body">${renderWorkflowBucketBoard(state)}</div>
        </div>
        <div class="cs-panel">
          <div class="cs-panel-head">
            <div>
              <div class="cs-panel-title">Move-Out Lifecycle Records</div>
              <div class="cs-panel-sub">One persistent resident record moves from On Notice through inspection, MORF, Accounting, archive, and dispute follow-up.</div>
            </div>
            <button type="button" class="cs-btn cs-btn-sm" onclick="atlasCsDrill('moveOuts','all')">Clear Bucket</button>
          </div>
          <div class="cs-panel-body">${renderMoveOutTable(state)}</div>
        </div>
        <div class="cs-panel">
          <div class="cs-panel-head">
            <div>
              <div class="cs-panel-title">ATLAS Move-Out Counts by Property</div>
              <div class="cs-panel-sub">Monthly counts from ATLAS remain visible even before resident-level cases are imported.</div>
            </div>
          </div>
          <div class="cs-panel-body">${renderPropertySummaryTable(state)}</div>
        </div>
      </div>
      ${renderMoveOutDetail(state)}
    </div>`;
  }

  function renderEmptyWorkflowModule(state, config) {
    const rows = asArray(state[config.key]);
    return `<div class="cs-panel">
      <div class="cs-panel-head">
        <div>
          <div class="cs-panel-title">${escapeHtml(config.title)}</div>
          <div class="cs-panel-sub">${escapeHtml(config.sub)}</div>
        </div>
        <button type="button" class="cs-btn cs-btn-sm" onclick="atlasCsSetModule('questions')">${icon("question")} Build Questions</button>
      </div>
      <div class="cs-panel-body">
        ${rows.length ? `<div class="cs-table-wrap"><table class="cs-table"><tbody>${rows.map(row => `<tr><td>${escapeHtml(row.title || row.id)}</td><td>${statusPill(row.status || "Open")}</td></tr>`).join("")}</tbody></table></div>` : `<div class="cs-empty"><div><strong>No ${escapeHtml(config.title.toLowerCase())} records have been connected yet.</strong><br>${escapeHtml(config.empty)}</div></div>`}
      </div>
    </div>`;
  }

  function renderMobileInspectionFlow() {
    const steps = [
      ["Where am I?", "Property, building, floor, unit, room, or common area."],
      ["What am I inspecting?", "Template, room, component, and required fields."],
      ["What condition is it in?", "Condition buttons minimize typing in the field."],
      ["Take a photo", "Original photo stays intact; annotations become a separate copy."],
      ["Is action required?", "Recommendation, work task, or escalation."],
      ["Is the resident responsible?", "Finding stays separate from financial charge review."],
      ["What happens next?", "Review, MORF, accounting, dispute, and vendor follow-up."]
    ];
    return `<div class="cs-mobile-flow">${steps.map(([title, copy]) => `<div class="cs-mobile-step"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(copy)}</span></div>`).join("")}</div>`;
  }

  function renderInspectionStartPanel(state, employees) {
    const propertyDefault = state.ui.inspectionStartProperty || (state.ui.propertyId === "all" ? getScopedProperties(state)[0]?.name || "" : state.ui.propertyId);
    return `<div class="cs-panel">
      <div class="cs-panel-head">
        <div>
          <div class="cs-panel-title">Universal ATLAS Inspection Engine</div>
          <div class="cs-panel-sub">One shared inspection workflow for move-outs, move-ins, routine condition, incidents, safety, vendor quality, turns, and custom templates.</div>
        </div>
        <button type="button" class="cs-btn cs-btn-sm" onclick="atlasCsSetModule('architecture')">${icon("blueprint")} Object Model</button>
      </div>
      <div class="cs-panel-body">
        ${renderMobileInspectionFlow()}
        <div class="cs-control-grid cs-control-grid-mobile" style="margin-top:14px">
          <label class="cs-field"><span>Inspection Type</span><select id="atlas-cs-inspection-template">${inspectionTemplateOptionsHtml(state, state.inspectionTemplates[0]?.id)}</select></label>
          <label class="cs-field"><span>Property</span><select id="atlas-cs-inspection-property" onchange="atlasCsSetInspectionStartProperty(this.value)">${propertyOptionsHtml(propertyDefault, false)}</select></label>
          <label class="cs-field"><span>Location Type</span><select id="atlas-cs-inspection-location-type">${genericOptionsHtml(["Apartment", "Common Area"], "Apartment")}</select></label>
          <label class="cs-field"><span>Building</span><input id="atlas-cs-inspection-building" placeholder="Building"></label>
          <label class="cs-field"><span>Floor</span><input id="atlas-cs-inspection-floor" placeholder="Auto where known"></label>
          <label class="cs-field"><span>Unit / Location</span><input id="atlas-cs-inspection-location" placeholder="Apartment or area"></label>
          <label class="cs-field"><span>Technician Search</span><input id="atlas-cs-inspection-inspector-search" value="${escapeAttr(state.ui.inspectorSearch || "")}" oninput="atlasCsSetInspectorSearch(this.value)" placeholder="Name, property, position, region, portfolio"></label>
          <label class="cs-field"><span>Inspector</span><select id="atlas-cs-inspection-inspector">${inspectionEmployeeOptionsHtml(state, "", propertyDefault, state.ui.inspectorSearch)}</select></label>
          <label class="cs-field"><span>Resident Present?</span><select id="atlas-cs-inspection-resident-present">${yesNoOptionsHtml("No")}</select></label>
          <div class="cs-field"><span>&nbsp;</span><button type="button" class="cs-btn" onclick="atlasCsFocusInspectorSearch()">${icon("magnifying-glass")} Assign Another Technician</button></div>
          <div class="cs-field"><span>&nbsp;</span><button type="button" class="cs-btn cs-btn-primary" onclick="atlasCsStartInspectionFromControls()">${icon("plus")} Start Inspection</button></div>
        </div>
      </div>
    </div>`;
  }

  function renderInspectionTemplateAdmin(state) {
    return `<div class="cs-panel">
      <div class="cs-panel-head">
        <div>
          <div class="cs-panel-title">Template Administration</div>
          <div class="cs-panel-sub">Administrators can add templates without development work. Existing templates stay standardized for reporting.</div>
        </div>
      </div>
      <div class="cs-panel-body">
        <div class="cs-template-grid" style="margin-bottom:12px">
          ${state.inspectionTemplates.map(template => `<div class="cs-template-card">
            <div class="cs-template-head">
              <strong>${escapeHtml(template.name)}</strong>
              <span class="cs-chip">${escapeHtml(template.category)}</span>
            </div>
            <div class="cs-template-meta">${escapeHtml(asArray(template.sections).slice(0, 5).join(" / "))}</div>
            <div class="cs-chip-row">
              <span class="cs-chip ${template.requiredPhotos ? "is-strong" : ""}">${template.requiredPhotos ? "Photos required" : "Photos optional"}</span>
              <span class="cs-chip ${template.chargebackAvailability ? "is-strong" : ""}">${template.chargebackAvailability ? "Chargebacks available" : "No chargebacks"}</span>
              <span class="cs-chip ${template.approvalRequired ? "is-strong" : ""}">${template.approvalRequired ? "Approval required" : "Approval optional"}</span>
            </div>
          </div>`).join("")}
        </div>
        <div class="cs-control-grid">
          <label class="cs-field"><span>New Template Name</span><input id="atlas-cs-template-name" placeholder="Inspection template"></label>
          <label class="cs-field"><span>Category</span><input id="atlas-cs-template-category" placeholder="Move-Out, Risk, Vendor"></label>
          <label class="cs-field"><span>Photos</span><select id="atlas-cs-template-photos">${yesNoOptionsHtml("Yes")}</select></label>
          <label class="cs-field"><span>Chargebacks</span><select id="atlas-cs-template-chargebacks">${yesNoOptionsHtml("No")}</select></label>
          <label class="cs-field"><span>Approval</span><select id="atlas-cs-template-approval">${yesNoOptionsHtml("Yes")}</select></label>
          <label class="cs-field" style="grid-column:span 3"><span>Sections</span><input id="atlas-cs-template-sections" placeholder="Location, Findings, Photos, Signatures, Review"></label>
          <div class="cs-field"><span>&nbsp;</span><button type="button" class="cs-btn" onclick="atlasCsAddInspectionTemplate()">${icon("plus")} Add Template</button></div>
        </div>
      </div>
    </div>`;
  }

  function renderInspectionTable(state) {
    const inspections = getScopedInspections(state);
    if (!inspections.length) {
      return `<div class="cs-empty"><div><strong>No field inspections have been created yet.</strong><br>Start an inspection above, or open a move-out case and create the linked move-out inspection from that record.</div></div>`;
    }
    return `<div class="cs-table-wrap">
      <table class="cs-table">
        <thead><tr><th>Inspection</th><th>Location</th><th>Inspector</th><th>Status</th><th>Sync</th><th class="right">Findings</th><th class="right">Docs</th><th></th></tr></thead>
        <tbody>
          ${inspections.map(inspection => {
            const missing = getInspectionMissingPhotoChargeCount(inspection);
            return `<tr class="${state.ui.selectedInspectionId === inspection.id ? "is-selected" : ""}">
              <td><div class="cs-name-cell"><strong>${escapeHtml(inspection.templateName)}</strong><span>${escapeHtml(formatDate(inspection.inspectionDate) || "Today")} ${inspection.relatedMoveOutId ? "- linked move-out" : ""}</span></div></td>
              <td><div class="cs-name-cell"><strong>${escapeHtml(inspection.propertyName)}</strong><span>${escapeHtml(getInspectionLocationLabel(inspection))}</span></div></td>
              <td>${escapeHtml(inspection.inspectorName || "Unassigned")}</td>
              <td>${statusPill(inspection.status)}</td>
              <td>${statusPill(inspection.syncStatus)}</td>
              <td class="right">${formatNumber(asArray(inspection.findings).length)}</td>
              <td class="right">${missing ? `<span class="cs-chip" data-tone="red">${formatNumber(missing)} missing</span>` : `<span class="cs-chip" data-tone="green">Ready</span>`}</td>
              <td class="right"><button type="button" class="cs-btn cs-btn-sm" data-id="${escapeAttr(inspection.id)}" onclick="atlasCsSelectInspection(this.dataset.id)">Open</button></td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>`;
  }

  function renderMoveOutInspectionQueue(state) {
    const rows = getMoveOutWorkflowBuckets(state).inspections;
    if (!rows.length) return `<div class="cs-empty"><div><strong>No move-out inspections are ready.</strong><br>Residents appear here after actual possession is confirmed and the inspection is released from hold.</div></div>`;
    return `<div class="cs-table-wrap">
      <table class="cs-table">
        <thead><tr><th>Resident</th><th>Property / Unit</th><th>Actual Possession</th><th>Inspection Date</th><th>Inspector</th><th>Status</th><th>Days Overdue</th><th>Resident Attending</th><th></th></tr></thead>
        <tbody>
          ${rows.map(caseRecord => {
            const inspection = getMoveOutInspectionForCase(state, caseRecord);
            const inspectionDate = inspection?.inspectionDate || caseRecord.inspectionDate;
            const overdue = daysUntil(inspectionDate);
            return `<tr class="${overdue !== null && overdue < 0 ? "cs-row-danger" : ""}">
              <td><div class="cs-name-cell"><strong>${escapeHtml(caseRecord.residentName)}</strong><span>${escapeHtml(caseRecord.email || caseRecord.phone || "Contact pending")}</span></div></td>
              <td><div class="cs-name-cell"><strong>${escapeHtml(caseRecord.propertyName)}</strong><span>Unit ${escapeHtml(caseRecord.unit || "n/a")}</span></div></td>
              <td>${escapeHtml(formatDate(getActualPossessionDate(caseRecord)) || "Required")}</td>
              <td>${escapeHtml(formatDate(inspectionDate) || "Not scheduled")}</td>
              <td>${escapeHtml(inspection?.inspectorName || caseRecord.inspectorName || "Unassigned")}</td>
              <td>${statusPill(inspection?.status || caseRecord.inspectionStatus || "Inspection Scheduled")}</td>
              <td>${overdue !== null && overdue < 0 ? `${escapeHtml(Math.abs(overdue))} days` : "0"}</td>
              <td>${escapeHtml(inspection?.residentPresent || "Unknown")}</td>
              <td class="right">
                <button type="button" class="cs-btn cs-btn-sm" data-id="${escapeAttr(caseRecord.id)}" onclick="atlasCsCreateInspectionFromMoveOut(this.dataset.id)">Open Inspection</button>
                <button type="button" class="cs-btn cs-btn-sm" data-id="${escapeAttr(caseRecord.id)}" onclick="atlasCsAssignInspector(this.dataset.id)">Assign</button>
                <button type="button" class="cs-btn cs-btn-sm" data-id="${escapeAttr(caseRecord.id)}" onclick="atlasCsRescheduleInspection(this.dataset.id)">Reschedule</button>
                <button type="button" class="cs-btn cs-btn-sm" data-id="${escapeAttr(caseRecord.id)}" onclick="atlasCsSelectMoveOut(this.dataset.id)">Lifecycle</button>
              </td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>`;
  }

  function renderInspectionIncidentFields(inspection) {
    if (inspection.templateName !== "Incident Report") return "";
    const fields = [
      ["People involved", "peopleInvolved"],
      ["Witnesses", "witnesses"],
      ["Police report #", "policeReportNumber"],
      ["Fire report #", "fireReportNumber"],
      ["Narrative", "narrative"]
    ];
    return `<div class="cs-field-cluster">
      <div class="cs-field-cluster-title">Incident Report Fields</div>
      <div class="cs-section-grid">
        ${fields.map(([label, field]) => `<label class="cs-field"><span>${escapeHtml(label)}</span><textarea onchange="atlasCsUpdateInspectionField('${escapeAttr(inspection.id)}','${escapeAttr(field)}',this.value)">${escapeHtml(inspection[field] || "")}</textarea></label>`).join("")}
      </div>
      <div class="cs-chip-row">
        ${["injuryInvolved", "insuranceClaim", "emergencyServicesContacted", "legalRiskEscalation"].map(field => `<label class="cs-toggle-chip"><input type="checkbox" ${inspection[field] ? "checked" : ""} onchange="atlasCsUpdateInspectionField('${escapeAttr(inspection.id)}','${field}',this.checked ? 'Yes' : '')"><span>${escapeHtml(field.replace(/([A-Z])/g, " $1"))}</span></label>`).join("")}
      </div>
    </div>`;
  }

  function renderInspectionFindingComposer(state, inspection, employees) {
    const template = getInspectionTemplateById(state, inspection.templateId);
    return `<div class="cs-finding-composer">
      <div class="cs-field-cluster-title">Add Finding</div>
      <div class="cs-control-grid cs-control-grid-mobile">
        <label class="cs-field"><span>Room / Area</span><select id="atlas-cs-finding-room">${roomOptionsHtml(state, inspection.room || "")}</select></label>
        <label class="cs-field"><span>Component</span><select id="atlas-cs-finding-component">${componentOptionsHtml(state, "")}</select></label>
        <label class="cs-field"><span>Condition</span><select id="atlas-cs-finding-condition">${conditionOptionsHtml(template, "")}</select></label>
        <label class="cs-field"><span>Resident Responsible?</span><select id="atlas-cs-finding-responsibility">${genericOptionsHtml(RESIDENT_RESPONSIBILITY_OPTIONS, "Needs Review")}</select></label>
        <label class="cs-field"><span>Chargeback Catalog</span><select id="atlas-cs-finding-chargeback">${chargebackOptionsHtml(state, "")}</select></label>
        <label class="cs-field"><span>Action Routing</span><select id="atlas-cs-finding-action">${genericOptionsHtml(["Recommendation Only", "Create Work Task / Escalation"], "Recommendation Only")}</select></label>
        <label class="cs-field"><span>In-House?</span><select id="atlas-cs-finding-inhouse">${yesNoOptionsHtml("Yes")}</select></label>
        <label class="cs-field"><span>Assigned Party</span><select id="atlas-cs-finding-assignee">${propertyEmployeeOptionsHtml(employees, "Unassigned")}</select></label>
        <label class="cs-field"><span>AI Suggested Condition</span><select id="atlas-cs-finding-ai">${genericOptionsHtml(["", ...DEFAULT_CONDITION_CHOICES], "")}</select></label>
        <label class="cs-field"><span>AI Confidence</span><input id="atlas-cs-finding-ai-confidence" type="number" min="0" max="100" value="0"></label>
        <label class="cs-field" style="grid-column:span 2"><span>Notes</span><textarea id="atlas-cs-finding-notes" placeholder="Dictation-ready field notes"></textarea></label>
        <div class="cs-field"><span>&nbsp;</span><button type="button" class="cs-btn cs-btn-primary" data-id="${escapeAttr(inspection.id)}" onclick="atlasCsAddInspectionFinding(this.dataset.id)">${icon("plus")} Add Finding</button></div>
      </div>
    </div>`;
  }

  function renderInspectionPhotos(inspection, finding) {
    const photos = asArray(finding.photos);
    if (!photos.length) return `<div class="cs-alert">No photos yet. Resident chargebacks normally require at least one supporting image before submission.</div>`;
    return `<div class="cs-photo-strip">${photos.map(photo => `<div class="cs-photo-card">
      ${photo.dataUrl ? `<img src="${escapeAttr(photo.dataUrl)}" alt="${escapeAttr(photo.fileName || "Inspection photo")}">` : `<div class="cs-photo-placeholder">${icon("image-square")}</div>`}
      <div class="cs-photo-meta"><strong>${escapeHtml(photo.fileName || "Inspection photo")}</strong><span>Original preserved${asArray(photo.annotations).length ? ` / ${asArray(photo.annotations).length} annotations` : ""}</span></div>
      <div class="cs-chip-row">
        ${["Circle", "Arrow", "Freehand", "Highlight", "Text", "Crop"].map(tool => `<button type="button" class="cs-icon-btn" title="${escapeAttr(tool)} annotation" data-inspection="${escapeAttr(inspection.id)}" data-finding="${escapeAttr(finding.id)}" data-photo="${escapeAttr(photo.id)}" data-tool="${escapeAttr(tool)}" onclick="atlasCsAddPhotoAnnotation(this.dataset.inspection,this.dataset.finding,this.dataset.photo,this.dataset.tool)">${escapeHtml(tool.slice(0, 1))}</button>`).join("")}
      </div>
    </div>`).join("")}</div>`;
  }

  function renderInspectionFindingCards(state, inspection) {
    const findings = asArray(inspection.findings);
    if (!findings.length) return `<div class="cs-empty"><div><strong>No findings documented yet.</strong><br>Add room-by-room findings as the inspector walks the unit or property.</div></div>`;
    return `<div class="cs-finding-list">${findings.map(finding => {
      const catalogItem = getChargebackCatalogItem(state, finding.chargebackId);
      const missingPhoto = findingHasResidentCharge(finding) && !findingHasPhoto(finding) && !findingHasPhotoOverride(finding);
      return `<div class="cs-finding-card ${missingPhoto ? "is-blocked" : ""}">
        <div class="cs-finding-head">
          <div>
            <strong>${escapeHtml(finding.room || "Room")} / ${escapeHtml(finding.component || "Component")}</strong>
            <span>${escapeHtml(finding.notes || "No notes entered")}</span>
          </div>
          ${statusPill(finding.condition || "Needs Review")}
        </div>
        <div class="cs-section-grid">
          <label class="cs-field"><span>Condition</span><select onchange="atlasCsUpdateFindingField('${escapeAttr(inspection.id)}','${escapeAttr(finding.id)}','condition',this.value)">${conditionOptionsHtml(getInspectionTemplateById(state, inspection.templateId), finding.condition)}</select></label>
          <label class="cs-field"><span>Resident Responsible?</span><select onchange="atlasCsUpdateFindingField('${escapeAttr(inspection.id)}','${escapeAttr(finding.id)}','residentResponsibility',this.value)">${genericOptionsHtml(RESIDENT_RESPONSIBILITY_OPTIONS, finding.residentResponsibility || "Needs Review")}</select></label>
          <label class="cs-field"><span>Chargeback</span><select onchange="atlasCsUpdateFindingField('${escapeAttr(inspection.id)}','${escapeAttr(finding.id)}','chargebackId',this.value)">${chargebackOptionsHtml(state, finding.chargebackId)}</select></label>
          <label class="cs-field"><span>Inspector Decision</span><select onchange="atlasCsUpdateFindingField('${escapeAttr(inspection.id)}','${escapeAttr(finding.id)}','aiInspectorDecision',this.value)">${genericOptionsHtml(["Not Reviewed", "Confirmed", "Modified", "Rejected"], finding.aiInspectorDecision || "Not Reviewed")}</select></label>
        </div>
        ${catalogItem ? `<div class="cs-charge-calc">${escapeHtml(formatChargeCalculation(state, catalogItem, inspection.propertyName))}</div>` : ""}
        ${finding.aiSuggestedCondition ? `<div class="cs-alert">AI Suggested Condition: <strong>${escapeHtml(finding.aiSuggestedCondition)}</strong> at ${escapeHtml(finding.aiConfidence || 0)}% confidence. Inspector decision: ${escapeHtml(finding.aiInspectorDecision || "Not Reviewed")}.</div>` : ""}
        ${missingPhoto ? `<div class="cs-alert is-danger">Photo documentation is required before this resident charge can be submitted. Authorized users can override with a permanent reason.</div>` : ""}
        ${finding.photoRequirementOverride?.reason ? `<div class="cs-alert is-warn">Photo override: ${escapeHtml(finding.photoRequirementOverride.reason)} by ${escapeHtml(finding.photoRequirementOverride.user || "authorized user")} on ${escapeHtml(formatDate(finding.photoRequirementOverride.at) || finding.photoRequirementOverride.at)}.</div>` : ""}
        <div class="cs-chip-row">
          <label class="cs-photo-upload">${icon("camera")} Add photos<input type="file" accept="image/*" capture="environment" multiple data-inspection="${escapeAttr(inspection.id)}" data-finding="${escapeAttr(finding.id)}" onchange="atlasCsAttachInspectionPhotos(this,this.dataset.inspection,this.dataset.finding)"></label>
          <button type="button" class="cs-btn cs-btn-sm" data-inspection="${escapeAttr(inspection.id)}" data-finding="${escapeAttr(finding.id)}" onclick="atlasCsOverridePhotoRequirement(this.dataset.inspection,this.dataset.finding)">Override Photo Requirement</button>
          <button type="button" class="cs-btn cs-btn-sm cs-btn-danger" data-inspection="${escapeAttr(inspection.id)}" data-finding="${escapeAttr(finding.id)}" onclick="atlasCsDeleteInspectionFinding(this.dataset.inspection,this.dataset.finding)">Remove</button>
        </div>
        ${renderInspectionPhotos(inspection, finding)}
      </div>`;
    }).join("")}</div>`;
  }

  function renderInspectionSignaturePanel(inspection) {
    return `<div class="cs-field-cluster">
      <div class="cs-field-cluster-title">Signatures</div>
      <div class="cs-chip-row">
        ${["Inspector", "Resident", "Vendor", "Witness"].map(role => `<button type="button" class="cs-btn cs-btn-sm" data-id="${escapeAttr(inspection.id)}" data-role="${escapeAttr(role)}" onclick="atlasCsAddInspectionSignature(this.dataset.id,this.dataset.role)">${icon("signature")} ${escapeHtml(role)}</button>`).join("")}
      </div>
      ${asArray(inspection.signatures).length ? `<div class="cs-table-wrap" style="margin-top:10px"><table class="cs-table"><thead><tr><th>Name</th><th>Role</th><th>Signed</th><th>Session</th></tr></thead><tbody>${inspection.signatures.map(signature => `<tr><td>${escapeHtml(signature.name)}</td><td>${escapeHtml(signature.role)}</td><td>${escapeHtml(formatDate(signature.at) || signature.at)}</td><td>${escapeHtml(signature.deviceSession || "ATLAS browser session")}</td></tr>`).join("")}</tbody></table></div>` : `<div class="cs-alert" style="margin-top:10px">No signatures captured yet.</div>`}
    </div>`;
  }

  function renderInspectionDetail(state, employees) {
    const inspections = getScopedInspections(state);
    const inspection = inspections.find(item => item.id === state.ui.selectedInspectionId) || inspections[0];
    if (!inspection) {
      return `<div class="cs-detail-panel"><div class="cs-detail-title"><h3>Inspection Detail</h3></div><div class="cs-alert">Start or open an inspection to work room-by-room from a mobile-ready layout.</div></div>`;
    }
    const template = getInspectionTemplateById(state, inspection.templateId);
    const relatedCase = getInspectionRelatedCase(state, inspection);
    const missingPhotoCount = getInspectionMissingPhotoChargeCount(inspection);
    const fields = [
      ["Template", inspection.templateName],
      ["Property", inspection.propertyName],
      ["Location", getInspectionLocationLabel(inspection)],
      ["Resident", inspection.residentName],
      ["Resident Present", inspection.residentPresent || "No"],
      ["Inspector", inspection.inspectorName],
      ["Inspection Date", formatDate(inspection.inspectionDate)],
      ["Move-Out Case", relatedCase ? relatedCase.id : "Not linked"]
    ];
    return `<div class="cs-detail-panel cs-inspection-detail">
      <div class="cs-detail-title">
        <div>
          <h3>${escapeHtml(inspection.templateName)}</h3>
          <div class="cs-detail-meta">${escapeHtml(inspection.propertyName)} - ${escapeHtml(getInspectionLocationLabel(inspection))}</div>
        </div>
        ${statusPill(inspection.status)}
      </div>
      <div class="cs-section-grid">
        ${fields.map(([label, value]) => `<div class="cs-data-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || "Not captured")}</strong></div>`).join("")}
      </div>
      <div class="cs-chip-row">
        <select onchange="atlasCsUpdateInspectionStatus('${escapeAttr(inspection.id)}',this.value)">${statusOptionsHtml(INSPECTION_STATUSES, inspection.status)}</select>
        <select onchange="atlasCsMarkInspectionSyncStatus('${escapeAttr(inspection.id)}',this.value)">${statusOptionsHtml(INSPECTION_SYNC_STATUSES, inspection.syncStatus)}</select>
        <button type="button" class="cs-btn cs-btn-sm" data-id="${escapeAttr(inspection.id)}" onclick="atlasCsSubmitInspection(this.dataset.id)">Submit</button>
        <button type="button" class="cs-btn cs-btn-sm" data-id="${escapeAttr(inspection.id)}" onclick="atlasCsApproveInspection(this.dataset.id)">Approve</button>
        <button type="button" class="cs-btn cs-btn-sm" data-id="${escapeAttr(inspection.id)}" onclick="atlasCsDownloadInspectionReport(this.dataset.id,'internal')">Internal Report</button>
        <button type="button" class="cs-btn cs-btn-sm" data-id="${escapeAttr(inspection.id)}" onclick="atlasCsDownloadInspectionReport(this.dataset.id,'resident')">Resident Copy</button>
      </div>
      ${missingPhotoCount ? `<div class="cs-alert is-danger">${escapeHtml(missingPhotoCount)} resident charge recommendation still needs photo support or an authorized override before submission.</div>` : ""}
      ${template.escalationRules?.length ? `<div class="cs-alert">${escapeHtml(template.escalationRules.join(" "))}</div>` : ""}
      ${renderInspectionIncidentFields(inspection)}
      ${renderInspectionFindingComposer(state, inspection, employees)}
      ${renderInspectionFindingCards(state, inspection)}
      ${renderInspectionSignaturePanel(inspection)}
      <div class="cs-field-cluster">
        <div class="cs-field-cluster-title">Permanent Audit Trail</div>
        ${renderMiniTimeline([...asArray(inspection.audit), ...asArray(inspection.activity)])}
      </div>
    </div>`;
  }

  function renderInspections(state, employees) {
    return `<div class="cs-two-col cs-two-col-wide">
      <div style="display:grid;gap:14px">
        ${renderInspectionStartPanel(state, employees)}
        <div class="cs-panel">
          <div class="cs-panel-head">
            <div>
              <div class="cs-panel-title">Move-Out Inspections</div>
              <div class="cs-panel-sub">Possession-confirmed lifecycle records ready for the universal ATLAS inspection workflow.</div>
            </div>
          </div>
          <div class="cs-panel-body">${renderMoveOutInspectionQueue(state)}</div>
        </div>
        <div class="cs-panel">
          <div class="cs-panel-head">
            <div>
              <div class="cs-panel-title">Inspection Queue</div>
              <div class="cs-panel-sub">Shared inspections use the same object model across desktop ATLAS and the future mobile application.</div>
            </div>
          </div>
          <div class="cs-panel-body">${renderInspectionTable(state)}</div>
        </div>
        ${renderInspectionTemplateAdmin(state)}
      </div>
      ${renderInspectionDetail(state, employees)}
    </div>`;
  }

  function sumAmountRows(rows, field = "amount") {
    return asArray(rows).reduce((sum, row) => sum + numberValue(row[field]), 0);
  }

  function getMorfTotals(morf) {
    const deposits = sumAmountRows(morf.deposits);
    const inspectionCharges = asArray(morf.charges).reduce((sum, row) => sum + numberValue(row.finalAmount || row.recommendedAmount), 0);
    const utilities = sumAmountRows(morf.finalUtilities);
    const rent = sumAmountRows(morf.finalRent);
    const recurring = sumAmountRows(morf.recurringCharges);
    const pastDue = sumAmountRows(morf.pastDueCharges);
    const credits = sumAmountRows(morf.credits);
    const lawfulDeductions = inspectionCharges + utilities + rent + recurring + pastDue;
    const net = deposits + credits - lawfulDeductions;
    return {
      deposits,
      inspectionCharges,
      utilities,
      rent,
      recurring,
      pastDue,
      credits,
      lawfulDeductions,
      balanceDueToResident: Math.max(0, net),
      balanceDueToProperty: Math.max(0, net * -1)
    };
  }

  function getMorfPrimaryForwardingAddress(morf) {
    return asArray(morf.forwardingAddresses).find(address => address.type === "Primary")?.address || morf.forwardingAddress || "";
  }

  function getMorfRelatedCase(state, morf) {
    return findMoveOutCase(state, morf.moveOutCaseId) || null;
  }

  function getMorfCompletionMissing(state, morf) {
    const caseRecord = getMorfRelatedCase(state, morf);
    const possessionDate = normalizeDate(morf.possessionReturnedDate || getActualPossessionDate(caseRecord || {}));
    const inspectionApproved = morf.inspectionApprovalStatus === "Approved" || caseRecord && caseInspectionIsApproved(state, caseRecord);
    const missing = [];
    if (!morf.residentName || !morf.propertyName || !morf.unit || !morf.phone && !morf.email) missing.push("Resident information complete");
    if (!possessionDate) missing.push("Actual possession date present");
    if (!getMorfPrimaryForwardingAddress(morf)) missing.push("Forwarding address complete");
    if (!inspectionApproved) missing.push("Inspection approved");
    if (!morf.chargesReviewed) missing.push("Charges reviewed");
    if (!morf.depositVerified) missing.push("Deposit verified");
    if (!morf.utilitiesReviewed) missing.push("Final utilities entered or reviewed");
    if (!morf.ledgerReviewed) missing.push("Other ledger charges reviewed");
    if (!morf.calculationConfirmed) missing.push("Refund/balance calculation confirmed");
    if (!normalizeDate(morf.legalDeadline || calculateLegalDeadlineForCase(state, caseRecord || morf))) missing.push("State deadline calculated");
    asArray(morf.charges).forEach(charge => {
      if (numberValue(charge.finalAmount) !== numberValue(charge.recommendedAmount) && !cleanString(charge.adjustmentReason)) {
        missing.push(`Adjustment reason for ${charge.description || charge.id}`);
      }
    });
    return missing;
  }

  function calculateAccountingTiming(morf) {
    const legalDeadline = normalizeDate(morf.legalDeadline);
    const completedDate = normalizeDate(morf.finalizedAt || morf.approvedAt || TODAY_ISO);
    const remaining = legalDeadline ? daysBetween(completedDate, legalDeadline) : null;
    return {
      estimatedSendByDate: legalDeadline,
      accountingTimeRemainingDays: remaining
    };
  }

  function getDisputeEligibility(state, morf) {
    const rule = getStateComplianceRuleForProperty(state, morf.propertyName);
    const handoff = asObject(morf.accountingHandoff);
    const baseDate = normalizeDate(handoff.sentAt || morf.accountingSentAt || morf.archivedAt);
    if (!rule || !rule.disputeWindowDays) {
      return {
        configured: false,
        eligible: false,
        through: "",
        label: "State dispute window not configured"
      };
    }
    if (!baseDate) {
      return {
        configured: true,
        eligible: false,
        through: "",
        label: "Accounting handoff date pending"
      };
    }
    const through = normalizeKey(rule.dayRule).includes("business")
      ? addBusinessDaysWithSettings(state, baseDate, rule.disputeWindowDays)
      : addDays(baseDate, rule.disputeWindowDays);
    const eligible = dateIsOnOrBefore(TODAY_ISO, through);
    return {
      configured: true,
      eligible,
      through,
      label: eligible ? `Dispute Eligible Through: ${formatDate(through)}` : "Dispute Window Closed"
    };
  }

  function renderMorfValidationPanel(state, morf) {
    const missing = getMorfCompletionMissing(state, morf);
    const checks = [
      ["chargesReviewed", "Charges reviewed"],
      ["depositVerified", "Deposit verified"],
      ["utilitiesReviewed", "Final utilities entered/reviewed"],
      ["ledgerReviewed", "Other ledger charges reviewed"],
      ["calculationConfirmed", "Refund/balance calculation confirmed"]
    ];
    return `<div class="cs-field-cluster">
      <div class="cs-field-cluster-title">MORF Completion Validation</div>
      ${missing.length ? `<div class="cs-alert is-warn">Finalize MORF is blocked until these requirements are complete: ${escapeHtml(missing.join(", "))}.</div>` : `<div class="cs-alert is-good">All finalization requirements are complete. The Central Services processor may finalize this MORF without a second approver.</div>`}
      <div class="cs-validation-list">
        ${checks.map(([field, label]) => `<label><input type="checkbox" ${morf[field] ? "checked" : ""} data-id="${escapeAttr(morf.id)}" data-field="${escapeAttr(field)}" onchange="atlasCsToggleMorfValidation(this.dataset.id,this.dataset.field,this.checked)"><span>${escapeHtml(label)}</span></label>`).join("")}
      </div>
    </div>`;
  }

  function renderMorfLedgerLines(morf) {
    const groups = [
      ["Deposits / Credits", [...asArray(morf.deposits).map(row => ({ ...row, kind: "Deposit" })), ...asArray(morf.credits).map(row => ({ ...row, kind: "Credit" }))]],
      ["Final Utilities", asArray(morf.finalUtilities).map(row => ({ ...row, kind: "Utility" }))],
      ["Past-Due / Lease Charges", [...asArray(morf.pastDueCharges).map(row => ({ ...row, kind: "Past Due" })), ...asArray(morf.finalRent).map(row => ({ ...row, kind: "Final Rent" })), ...asArray(morf.recurringCharges).map(row => ({ ...row, kind: "Lease Charge" }))]]
    ];
    return `<div class="cs-field-cluster">
      <div class="cs-field-cluster-title">Ledger Detail</div>
      ${groups.map(([title, rows]) => rows.length ? `<div class="cs-table-wrap" style="margin-bottom:10px"><table class="cs-table"><thead><tr><th colspan="4">${escapeHtml(title)}</th></tr><tr><th>Type</th><th>Description</th><th>Source</th><th class="right">Amount</th></tr></thead><tbody>${rows.map(row => `<tr><td>${escapeHtml(row.kind)}</td><td>${escapeHtml(row.description || "Line item")}</td><td>${escapeHtml(row.source || "Manual entry")}</td><td class="right">${escapeHtml(formatMoney(row.amount) || "$0")}</td></tr>`).join("")}</tbody></table></div>` : "").join("") || `<div class="cs-alert">No ledger line items have been entered yet.</div>`}
    </div>`;
  }

  function buildAccountingEmailTemplate(state, morf, contact) {
    const totals = getMorfTotals(morf);
    const timing = calculateAccountingTiming(morf);
    const handoff = asObject(morf.accountingHandoff);
    const processor = morf.processor || currentActor().name;
    const subject = `MORF Ready for Processing - ${morf.propertyName} - ${morf.residentName} - Unit ${morf.unit || "n/a"}`;
    const body = [
      `Resident: ${morf.residentName}`,
      `Property: ${morf.propertyName}`,
      `Unit: ${morf.unit || "n/a"}`,
      `Actual move-out/possession date: ${formatDate(morf.possessionReturnedDate) || "Not captured"}`,
      `Refund due: ${formatMoney(totals.balanceDueToResident) || "$0"}`,
      `Balance due: ${formatMoney(totals.balanceDueToProperty) || "$0"}`,
      `State legal deadline: ${formatDate(morf.legalDeadline) || "Legal config required"}`,
      `Estimated Accounting Send-By Date: ${formatDate(timing.estimatedSendByDate) || "Not calculated"}`,
      `Remaining processing time: ${timing.accountingTimeRemainingDays === null ? "Not calculated" : `${timing.accountingTimeRemainingDays} days`}`,
      `Central Services processor: ${processor}`,
      `Special notes: ${handoff.specialNotes || morf.notes || "None"}`
    ].join("\n");
    return {
      to: contact?.email || "",
      subject,
      body
    };
  }

  function renderMorfTable(state, employees) {
    const filter = cleanString(state.ui.workflowFilter || "all");
    let morfs = getActiveScopedMorfs(state);
    if (filter === "morfReady") morfs = morfs.filter(morf => ["MORF Ready", "Ready for MORF"].includes(morf.status));
    if (filter === "morfInProgress") morfs = morfs.filter(morf => ["MORF In Progress", "Ready for Final Review", "MORF Finalized", "Approved"].includes(morf.status));
    if (filter === "waiting") morfs = morfs.filter(morf => ["Waiting on Site", "Waiting on Utilities", "Waiting on Documentation", "Waiting on Information"].includes(morf.status));
    if (filter === "risk") morfs = morfs.filter(morf => {
      const remaining = daysUntil(morf.legalDeadline);
      return remaining !== null && remaining <= 2 && morf.accountingHandoffStatus !== "Sent to Accounting";
    });
    return `<div class="cs-table-wrap">
      <table class="cs-table">
        <thead><tr><th>Resident</th><th>Property / Unit</th><th>Possession Returned</th><th>Inspection</th><th>Internal MORF Due</th><th>Legal Deadline</th><th>Processor</th><th>Status</th><th>Accounting</th><th></th></tr></thead>
        <tbody>
          ${morfs.map(morf => {
            const legalRemaining = daysUntil(morf.legalDeadline);
            const internalRemaining = daysUntil(morf.internalDueDate);
            return `<tr class="${state.ui.selectedMorfId === morf.id ? "is-selected" : ""}">
              <td><div class="cs-name-cell"><strong>${escapeHtml(morf.residentName)}</strong><span>${escapeHtml(morf.email || "Resident email pending")}</span></div></td>
              <td><div class="cs-name-cell"><strong>${escapeHtml(morf.propertyName)}</strong><span>Unit ${escapeHtml(morf.unit || "n/a")}</span></div></td>
              <td>${escapeHtml(formatDate(morf.possessionReturnedDate) || "Needed")}</td>
              <td>${statusPill(morf.inspectionApprovalStatus || "Inspection Pending")}</td>
              <td><div class="cs-name-cell"><strong>${escapeHtml(formatDate(morf.internalDueDate) || "Not set")}</strong><span>${internalRemaining === null ? "Internal SLA pending" : `${internalRemaining} days`}</span></div></td>
              <td><div class="cs-name-cell"><strong>${escapeHtml(formatDate(morf.legalDeadline) || "Legal config required")}</strong><span>${legalRemaining === null ? "State rule not configured" : `${legalRemaining} days remaining`}</span></div></td>
              <td>${escapeHtml(morf.processor || defaultOwner(employees))}</td>
              <td>${statusPill(morf.status)}</td>
              <td>${statusPill(morf.accountingHandoffStatus || "Not Sent")}</td>
              <td class="right"><button type="button" class="cs-btn cs-btn-sm" data-id="${escapeAttr(morf.id)}" onclick="atlasCsSelectMorf(this.dataset.id)">Open</button></td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>`;
  }

  function renderMorfChargesTable(state, morf) {
    if (!asArray(morf.charges).length) {
      return `<div class="cs-alert">No approved inspection charges have flowed into this MORF yet. Approve the linked move-out inspection to make charges available here.</div>`;
    }
    return `<div class="cs-table-wrap">
      <table class="cs-table">
        <thead><tr><th>Charge</th><th>Room / Damage</th><th>Photo</th><th>Inspector</th><th>Catalog</th><th>Final CS Amount</th><th>Adjustment Reason</th></tr></thead>
        <tbody>
          ${morf.charges.map(charge => `<tr>
            <td><div class="cs-name-cell"><strong>${escapeHtml(charge.description)}</strong><span>${escapeHtml(charge.category || "Resident Charge")}</span></div></td>
            <td><div class="cs-name-cell"><strong>${escapeHtml(charge.room || "Room")}</strong><span>${escapeHtml(charge.damage || "Damage")}</span></div></td>
            <td>${charge.thumbnail ? `<img class="cs-thumb" src="${escapeAttr(charge.thumbnail)}" alt="${escapeAttr(charge.description)}">` : `<span class="cs-chip">No image</span>`}</td>
            <td>${escapeHtml(formatMoney(charge.originalInspectorAmount) || "No amount shown")}</td>
            <td><div class="cs-name-cell"><strong>${escapeHtml(formatMoney(charge.recommendedAmount) || "$0")}</strong><span>${escapeHtml(charge.calculationSummary || "Catalog calculation")}</span></div></td>
            <td><input type="number" min="0" value="${escapeAttr(charge.finalAmount ?? charge.recommendedAmount ?? 0)}" data-morf="${escapeAttr(morf.id)}" data-charge="${escapeAttr(charge.id)}" onchange="atlasCsUpdateMorfCharge(this.dataset.morf,this.dataset.charge,'finalAmount',this.value)"></td>
            <td><input value="${escapeAttr(charge.adjustmentReason || "")}" placeholder="Required if edited" data-morf="${escapeAttr(morf.id)}" data-charge="${escapeAttr(charge.id)}" onchange="atlasCsUpdateMorfCharge(this.dataset.morf,this.dataset.charge,'adjustmentReason',this.value)"></td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
  }

  function renderMorfFinancialPanel(morf) {
    const totals = getMorfTotals(morf);
    const tiles = [
      ["Total Refundable Deposits", totals.deposits],
      ["Less Lawful Deductions/Charges", totals.lawfulDeductions],
      ["Additional Credits/Adjustments", totals.credits],
      ["Balance Due to Resident", totals.balanceDueToResident],
      ["Balance Due to Property", totals.balanceDueToProperty]
    ];
    return `<div class="cs-field-cluster">
      <div class="cs-field-cluster-title">MORF Financial Structure</div>
      <div class="cs-mini-kpi-grid">${tiles.map(([label, value]) => `<div class="cs-mini-kpi"><span>${escapeHtml(label)}</span><strong>${escapeHtml(formatMoney(value) || "$0")}</strong></div>`).join("")}</div>
      <div class="cs-chip-row" style="margin-top:10px">
        <button type="button" class="cs-btn cs-btn-sm" data-id="${escapeAttr(morf.id)}" data-kind="deposits" onclick="atlasCsAddMorfLine(this.dataset.id,this.dataset.kind)">Add Deposit</button>
        <button type="button" class="cs-btn cs-btn-sm" data-id="${escapeAttr(morf.id)}" data-kind="finalUtilities" onclick="atlasCsAddMorfLine(this.dataset.id,this.dataset.kind)">Add Utility</button>
        <button type="button" class="cs-btn cs-btn-sm" data-id="${escapeAttr(morf.id)}" data-kind="finalRent" onclick="atlasCsAddMorfLine(this.dataset.id,this.dataset.kind)">Add Rent</button>
        <button type="button" class="cs-btn cs-btn-sm" data-id="${escapeAttr(morf.id)}" data-kind="pastDueCharges" onclick="atlasCsAddMorfLine(this.dataset.id,this.dataset.kind)">Add Past-Due / Ledger Charge</button>
        <button type="button" class="cs-btn cs-btn-sm" data-id="${escapeAttr(morf.id)}" data-kind="recurringCharges" onclick="atlasCsAddMorfLine(this.dataset.id,this.dataset.kind)">Add Lease Charge</button>
        <button type="button" class="cs-btn cs-btn-sm" data-id="${escapeAttr(morf.id)}" data-kind="credits" onclick="atlasCsAddMorfLine(this.dataset.id,this.dataset.kind)">Add Credit</button>
      </div>
    </div>`;
  }

  function renderMorfPacketChecklist(morf) {
    const selected = new Set(asArray(morf.packetSelections));
    return `<div class="cs-field-cluster">
      <div class="cs-field-cluster-title">Accounting Packet Checklist</div>
      <div class="cs-check-list">
        ${ACCOUNTING_PACKET_OPTIONS.map(option => `<label><input type="checkbox" value="${escapeAttr(option)}" ${selected.has(option) ? "checked" : ""} data-id="${escapeAttr(morf.id)}" onchange="atlasCsToggleMorfPacket(this.dataset.id,this.value,this.checked)"><span>${escapeHtml(option)}</span></label>`).join("")}
      </div>
    </div>`;
  }

  function renderMorfDeliveryPanel(morf) {
    const delivery = asObject(morf.delivery);
    const fields = [
      ["Email sent date", "emailSentDate", "date"],
      ["Email address", "emailAddress", "email"],
      ["Certified mail date", "certifiedMailDate", "date"],
      ["Certified mail tracking #", "certifiedMailTracking", "text"],
      ["Delivery confirmation", "deliveryConfirmation", "text"],
      ["Returned mail", "returnedMail", "text"],
      ["Re-mail date", "remailDate", "date"],
      ["Updated forwarding address", "updatedForwardingAddress", "text"]
    ];
    return `<div class="cs-field-cluster">
      <div class="cs-field-cluster-title">Statement Delivery Tracking</div>
      <div class="cs-control-grid">
        ${fields.map(([label, field, type]) => `<label class="cs-field"><span>${escapeHtml(label)}</span><input type="${escapeAttr(type)}" value="${escapeAttr(delivery[field] || "")}" data-id="${escapeAttr(morf.id)}" data-field="${escapeAttr(field)}" onchange="atlasCsUpdateMorfDelivery(this.dataset.id,this.dataset.field,this.value)"></label>`).join("")}
      </div>
    </div>`;
  }

  function renderMorfStatementPanel(state, morf) {
    const rule = getStateComplianceRuleForProperty(state, morf.propertyName);
    const canGenerate = rule?.requiredStatutoryWording && rule?.depositAccountingDeadlineDays;
    const disputeEligibility = getDisputeEligibility(state, morf);
    return `<div class="cs-field-cluster">
      <div class="cs-field-cluster-title">Statement of Deposit Accounting</div>
      ${canGenerate ? `<div class="cs-alert is-good">State configuration found for ${escapeHtml(rule.state)}. Final statement will use configured wording version ${escapeHtml(rule.version)}.</div>` : `<div class="cs-alert is-warn">State-specific legal wording and deadline configuration are not complete. ATLAS will not invent statutory language for the final resident statement.</div>`}
      <div class="cs-alert ${disputeEligibility.eligible ? "is-good" : "is-warn"}">${escapeHtml(disputeEligibility.label)}</div>
      <div class="cs-chip-row">
        <button type="button" class="cs-btn cs-btn-sm" data-id="${escapeAttr(morf.id)}" onclick="atlasCsGenerateStatement(this.dataset.id)" ${canGenerate ? "" : "disabled"}>Generate Statement Version</button>
        <button type="button" class="cs-btn cs-btn-sm" data-id="${escapeAttr(morf.id)}" onclick="atlasCsCreateDisputeFromMorf(this.dataset.id)" ${disputeEligibility.eligible ? "" : "disabled"}>Open Dispute</button>
      </div>
      ${asArray(morf.statementVersions).length ? `<div class="cs-table-wrap" style="margin-top:10px"><table class="cs-table"><thead><tr><th>Version</th><th>Status</th><th>Statement Date</th><th>Resident Resent</th><th>Amount</th></tr></thead><tbody>${morf.statementVersions.map(version => `<tr><td>${escapeHtml(version.versionLabel)}</td><td>${statusPill(version.status || "Draft")}</td><td>${escapeHtml(formatDate(version.statementDate) || "Not sent")}</td><td>${escapeHtml(formatDate(version.resentAt) || "Not resent")}</td><td>${escapeHtml(formatMoney(version.balanceDueToResident || version.balanceDueToProperty) || "$0")}</td></tr>`).join("")}</tbody></table></div>` : ""}
    </div>`;
  }

  function renderMorfDetail(state, employees) {
    const morfs = getScopedMorfs(state);
    const morf = morfs.find(item => item.id === state.ui.selectedMorfId) || morfs[0];
    if (!morf) {
      return `<div class="cs-detail-panel"><div class="cs-detail-title"><h3>MORF Detail</h3></div><div class="cs-alert">Mark possession returned on a move-out case to create the MORF record.</div></div>`;
    }
    const caseRecord = getMorfRelatedCase(state, morf);
    const primaryAddress = getMorfPrimaryForwardingAddress(morf);
    const contact = getAccountingContactForCase(state, caseRecord || morf);
    const accountingTemplate = buildAccountingEmailTemplate(state, morf, contact);
    const timing = calculateAccountingTiming(morf);
    const canGeneratePackage = ["MORF Finalized", "Approved", "Sent to Accounting", "Archived / Open", "MORF Closed"].includes(morf.status);
    const fields = [
      ["Resident", morf.residentName],
      ["Additional Leaseholders", morf.additionalLeaseholders],
      ["Community", morf.propertyName],
      ["Unit", morf.unit],
      ["Move-In", formatDate(morf.moveInDate)],
      ["Scheduled Move-Out", formatDate(morf.scheduledMoveOutDate || morf.moveOutDate)],
      ["Actual Possession", formatDate(morf.possessionReturnedDate)],
      ["Phone", morf.phone],
      ["Email", morf.email],
      ["Inspection ID", morf.inspectionId],
      ["Inspection Approval", morf.inspectionApprovalStatus],
      ["Internal MORF Due", formatDate(morf.internalDueDate)],
      ["State Legal Deadline", formatDate(morf.legalDeadline) || "Legal config required"],
      ["Estimated Accounting Send-By", formatDate(timing.estimatedSendByDate) || "Not calculated"],
      ["Accounting Time Remaining", timing.accountingTimeRemainingDays === null ? "" : `${timing.accountingTimeRemainingDays} days`],
      ["Accounting Handoff", morf.accountingHandoffStatus || "Not Sent"]
    ];
    return `<div class="cs-detail-panel cs-morf-detail">
      <div class="cs-detail-title">
        <div>
          <h3>MORF - ${escapeHtml(morf.residentName)}</h3>
          <div class="cs-detail-meta">${escapeHtml(morf.propertyName)} - Unit ${escapeHtml(morf.unit || "n/a")}</div>
        </div>
        ${statusPill(morf.status)}
      </div>
      <div class="cs-chip-row">
        <select data-id="${escapeAttr(morf.id)}" onchange="atlasCsUpdateMorfField(this.dataset.id,'status',this.value)">${statusOptionsHtml(MORF_STATUSES, morf.status)}</select>
        <select data-id="${escapeAttr(morf.id)}" onchange="atlasCsUpdateMorfField(this.dataset.id,'processor',this.value)">${ownerOptionsHtml(employees, morf.processor || defaultOwner(employees))}</select>
        <button type="button" class="cs-btn cs-btn-sm" data-id="${escapeAttr(morf.id)}" onclick="atlasCsStartMorfProcessing(this.dataset.id)">Start Processing</button>
        <button type="button" class="cs-btn cs-btn-sm cs-btn-primary" data-id="${escapeAttr(morf.id)}" onclick="atlasCsFinalizeMorf(this.dataset.id)">Finalize MORF</button>
        <button type="button" class="cs-btn cs-btn-sm" data-id="${escapeAttr(morf.id)}" onclick="atlasCsGenerateMorfArtifacts(this.dataset.id)" ${canGeneratePackage ? "" : "disabled"}>Generate Package</button>
        <button type="button" class="cs-btn cs-btn-sm" data-id="${escapeAttr(morf.id)}" onclick="atlasCsSendMorfAccountingPacket(this.dataset.id)">Send to Accounting</button>
        <button type="button" class="cs-btn cs-btn-sm" data-id="${escapeAttr(morf.id)}" onclick="atlasCsLockMorf(this.dataset.id)">Lock</button>
      </div>
      ${morf.inspectionApprovalStatus !== "Approved" ? `<div class="cs-alert is-warn">Inspection Approval Required Before MORF Finalization.</div>` : ""}
      <div class="cs-section-grid">
        ${fields.map(([label, value]) => `<div class="cs-data-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || "Not captured")}</strong></div>`).join("")}
      </div>
      <label class="cs-field"><span>Primary Forwarding Address</span><textarea data-id="${escapeAttr(morf.id)}" onchange="atlasCsUpdateMorfField(this.dataset.id,'forwardingAddress',this.value)">${escapeHtml(primaryAddress)}</textarea></label>
      <div class="cs-chip-row"><button type="button" class="cs-btn cs-btn-sm" data-id="${escapeAttr(morf.id)}" onclick="atlasCsAddMorfForwardingAddress(this.dataset.id)">+ Add Additional Address</button></div>
      <div class="cs-field-cluster">
        <div class="cs-field-cluster-title">MOG Integration</div>
        <div class="cs-chip-row">
          ${["Generate / Preload MOG", "Upload Existing MOG", "Extract MOG Data"].map(method => `<button type="button" class="cs-btn cs-btn-sm" data-id="${escapeAttr(morf.id)}" data-method="${escapeAttr(method)}" onclick="atlasCsSetMogMethod(this.dataset.id,this.dataset.method)">${escapeHtml(method)}</button>`).join("")}
          <label class="cs-photo-upload">${icon("upload-simple")} Upload MOG<input type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" data-id="${escapeAttr(morf.id)}" onchange="atlasCsUploadMog(this,this.dataset.id)"></label>
        </div>
        <div class="cs-alert">Original uploaded MOG documents stay attached to the MORF record. Extracted fields remain editable.</div>
      </div>
      <div class="cs-field-cluster">
        <div class="cs-field-cluster-title">Inspection Charges Inside MORF</div>
        ${renderMorfChargesTable(state, morf)}
      </div>
      ${renderMorfFinancialPanel(morf)}
      ${renderMorfLedgerLines(morf)}
      ${renderMorfValidationPanel(state, morf)}
      ${renderMorfStatementPanel(state, morf)}
      ${renderMorfPacketChecklist(morf)}
      ${asArray(morf.generatedArtifacts).length ? `<div class="cs-field-cluster"><div class="cs-field-cluster-title">Generated Package</div>${renderMiniTimeline(asArray(morf.generatedArtifacts).map(item => ({ at: item.generatedAt, label: `${item.label} - ${item.status}` })))}</div>` : ""}
      <div class="cs-field-cluster">
        <div class="cs-field-cluster-title">Accounting Email</div>
        <div class="cs-section-grid">
          <div class="cs-data-row"><span>To</span><strong>${escapeHtml(accountingTemplate.to || "Accounting route not configured")}</strong></div>
          <div class="cs-data-row"><span>Subject</span><strong>${escapeHtml(accountingTemplate.subject)}</strong></div>
        </div>
        <pre class="cs-email-preview">${escapeHtml(accountingTemplate.body)}</pre>
      </div>
      ${renderMorfDeliveryPanel(morf)}
      <div class="cs-field-cluster">
        <div class="cs-field-cluster-title">Charge Audit Trail</div>
        ${renderMiniTimeline([...asArray(morf.audit), ...asArray(morf.activity)])}
      </div>
    </div>`;
  }

  function renderMorfs(state, employees) {
    const activeMorfs = getActiveScopedMorfs(state);
    return `<div class="cs-two-col cs-two-col-wide">
      <div style="display:grid;gap:14px">
        <div class="cs-panel">
          <div class="cs-panel-head">
            <div>
              <div class="cs-panel-title">MORF Workflow Buckets</div>
              <div class="cs-panel-sub">Ready, in-progress, waiting, deadline-risk, sent, and archived records are separated by status.</div>
            </div>
          </div>
          <div class="cs-panel-body">${renderWorkflowBucketBoard(state)}</div>
        </div>
        <div class="cs-panel">
          <div class="cs-panel-head">
            <div>
              <div class="cs-panel-title">Active MORFs</div>
              <div class="cs-panel-sub">Draft MORFs can be prepared early, but finalization stays blocked until inspection approval and completion checks are satisfied.</div>
            </div>
            <button type="button" class="cs-btn cs-btn-sm" onclick="atlasCsSetModule('architecture')">${icon("blueprint")} Workflow Model</button>
          </div>
          <div class="cs-panel-body">
            ${activeMorfs.length ? renderMorfTable(state, employees) : `<div class="cs-empty"><div><strong>No active MORFs are due yet.</strong><br>Confirm possession on a move-out lifecycle record to create a draft MORF, then approve the inspection to move it into processing.</div></div>`}
          </div>
        </div>
        <div class="cs-panel">
          <div class="cs-panel-head">
            <div>
              <div class="cs-panel-title">Move-Out Records Feeding MORF</div>
              <div class="cs-panel-sub">The underlying lifecycle record remains clickable from notice through Accounting handoff and archive.</div>
            </div>
          </div>
          <div class="cs-panel-body">${renderMoveOutTable(state)}</div>
        </div>
      </div>
      ${renderMorfDetail(state, employees)}
    </div>`;
  }

  function renderChargebackCatalog(state) {
    const selectedProperty = state.ui.propertyId === "all" ? getScopedProperties(state)[0]?.name || "" : state.ui.propertyId;
    return `<div style="display:grid;gap:14px">
      <div class="cs-panel">
        <div class="cs-panel-head">
          <div>
            <div class="cs-panel-title">Master Chargeback Catalog</div>
            <div class="cs-panel-sub">Portfolio rate, market multiplier, property override, useful life, depreciation method, and charge type stay separate for auditability.</div>
          </div>
        </div>
        <div class="cs-panel-body">
          <div class="cs-control-grid" style="margin-bottom:12px">
            <label class="cs-field"><span>Category</span><input id="atlas-cs-charge-category" placeholder="Cleaning, Paint, Flooring"></label>
            <label class="cs-field"><span>Item</span><input id="atlas-cs-charge-item" placeholder="Chargeback item"></label>
            <label class="cs-field"><span>Portfolio Standard</span><input id="atlas-cs-charge-cost" type="number" min="0" value="0"></label>
            <label class="cs-field"><span>Useful Life Months</span><input id="atlas-cs-charge-life" type="number" min="0" value="0"></label>
            <label class="cs-field"><span>Charge Type</span><select id="atlas-cs-charge-type">${genericOptionsHtml(CHARGE_TYPES, "Custom Charge")}</select></label>
            <div class="cs-field"><span>&nbsp;</span><button type="button" class="cs-btn cs-btn-primary" onclick="atlasCsAddChargebackCatalogItem()">${icon("plus")} Add Item</button></div>
          </div>
          <div class="cs-alert" style="margin-bottom:12px">${escapeHtml(selectedProperty ? `Calculator example for ${selectedProperty}: portfolio rate -> ZIP market multiplier -> property override. Master rates are not overwritten.` : "Choose a property scope to preview the pricing hierarchy.")}</div>
          <div class="cs-table-wrap">
            <table class="cs-table">
              <thead><tr><th>ID</th><th>Category</th><th>Item</th><th>Standard</th><th>Labor</th><th>Material</th><th>Useful Life</th><th>Charge Type</th><th>Pricing Hierarchy</th></tr></thead>
              <tbody>
                ${state.chargebackCatalog.map(item => `<tr>
                  <td>${escapeHtml(item.chargebackId)}</td>
                  <td>${escapeHtml(item.category)}</td>
                  <td><div class="cs-name-cell"><strong>${escapeHtml(item.item)}</strong><span>${escapeHtml(item.description)}</span></div></td>
                  <td>${escapeHtml(formatMoney(item.portfolioCost) || "$0")}</td>
                  <td>${escapeHtml(formatMoney(item.laborComponent) || "$0")}</td>
                  <td>${escapeHtml(formatMoney(item.materialComponent) || "$0")}</td>
                  <td>${item.usefulLifeMonths ? `${escapeHtml(item.usefulLifeMonths)} months` : "n/a"}</td>
                  <td>${escapeHtml(item.chargeType)}</td>
                  <td>${escapeHtml(selectedProperty ? formatChargeCalculation(state, item, selectedProperty) : "Select property")}</td>
                </tr>`).join("")}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div class="cs-panel">
        <div class="cs-panel-head">
          <div>
            <div class="cs-panel-title">Useful Life and Depreciation Controls</div>
            <div class="cs-panel-sub">Admin/VP and Legal-approved methodology can be configured without changing the underlying inspection records.</div>
          </div>
        </div>
        <div class="cs-panel-body">
          <div class="cs-architecture-grid">
            <div class="cs-architecture-item"><h3>Charge Determination Boundary</h3><p>Inspection findings document condition. Resident-responsibility decisions mark whether Central Services should review the item. Financial charges are finalized only inside MORF/deposit accounting.</p></div>
            <div class="cs-architecture-item"><h3>Photo Requirement</h3><p>Resident charge recommendations require photo evidence unless an authorized override records reason, user, date/time, and authorization level in the permanent audit history.</p></div>
            <div class="cs-architecture-item"><h3>Depreciation</h3><p>Useful life stores installation age, remaining life, replacement cost, and configured policy method. Jurisdiction/company legal policy controls final proration.</p></div>
            <div class="cs-architecture-item"><h3>Custom Charges</h3><p>Custom charge types require descriptions and are reviewable before flowing into resident-facing deposit accounting.</p></div>
          </div>
        </div>
      </div>
    </div>`;
  }

  function renderVendorDashboard(state) {
    const vendors = getScopedVendors(state);
    const preferred = vendors.filter(vendor => vendor.preferredPropertyVendor || vendor.preferredPortfolioVendor || vendor.adminOverridePreferred).length;
    const complianceIssues = vendors.filter(vendor => normalizeKey(vendor.complianceStatus).includes("issue") || normalizeKey(vendor.complianceStatus).includes("expired") || normalizeKey(vendor.complianceStatus).includes("review")).length;
    const callbacks = vendors.reduce((sum, vendor) => sum + whole(vendor.warrantyCallbacks), 0);
    const openWork = vendors.reduce((sum, vendor) => sum + whole(vendor.openWorkOrders), 0);
    const tiles = [
      ["Vendor Profiles", vendors.length],
      ["Preferred Vendors", preferred],
      ["Compliance Issues", complianceIssues],
      ["Open Work Orders", openWork],
      ["Warranty Callbacks", callbacks]
    ];
    return `<div class="cs-mini-kpi-grid">${tiles.map(([label, value]) => `<div class="cs-mini-kpi"><span>${escapeHtml(label)}</span><strong>${escapeHtml(formatNumber(value))}</strong></div>`).join("")}</div>`;
  }

  function renderVendorProfiles(state) {
    const vendors = getScopedVendors(state);
    const properties = state.ui.propertyId === "all" ? [] : [state.ui.propertyId];
    return `<div style="display:grid;gap:14px">
      <div class="cs-panel">
        <div class="cs-panel-head">
          <div>
            <div class="cs-panel-title">Vendor Management</div>
            <div class="cs-panel-sub">Vendor profiles reuse existing vendor names, Entrata vendor codes, property service scope, skills, compliance, work history, and performance signals.</div>
          </div>
        </div>
        <div class="cs-panel-body">
          ${renderVendorDashboard(state)}
          <div class="cs-control-grid" style="margin-top:12px">
            <label class="cs-field"><span>Vendor Name</span><input id="atlas-cs-vendor-name" placeholder="Vendor name"></label>
            <label class="cs-field"><span>Entrata Vendor Code</span><input id="atlas-cs-vendor-code" placeholder="Entrata code"></label>
            <label class="cs-field"><span>Compliance</span><select id="atlas-cs-vendor-compliance">${genericOptionsHtml(["Compliant", "Review Required", "Insurance Expired", "Do Not Use"], "Review Required")}</select></label>
            <label class="cs-field"><span>Quality Score</span><input id="atlas-cs-vendor-quality" type="number" min="0" max="100" value="0"></label>
            <label class="cs-field"><span>Reliability Score</span><input id="atlas-cs-vendor-reliability" type="number" min="0" max="100" value="0"></label>
            <label class="cs-field"><span>Cost Score</span><input id="atlas-cs-vendor-cost-score" type="number" min="0" max="100" value="0"></label>
            <label class="cs-field" style="grid-column:span 3"><span>Skills / Trades</span>${checkboxListHtml(state.vendorSkillLibrary, [], "atlas-cs-vendor-skill")}</label>
            <div class="cs-field"><span>&nbsp;</span><button type="button" class="cs-btn cs-btn-primary" onclick="atlasCsAddVendorProfile()">${icon("plus")} Add Vendor</button></div>
          </div>
          ${vendors.length ? `<div class="cs-table-wrap" style="margin-top:12px"><table class="cs-table"><thead><tr><th>Vendor</th><th>Skills</th><th>Compliance</th><th>Preferred</th><th>Workload</th><th>Scores</th><th>Recommendation</th><th></th></tr></thead><tbody>${vendors.map(vendor => {
            const score = calculateVendorScore(vendor);
            const preferredLabel = vendor.adminOverridePreferred ? "Admin Override" : vendor.preferredPortfolioVendor ? "Portfolio" : vendor.preferredPropertyVendor ? "Property" : score >= 85 && vendor.completedWorkOrders >= 10 ? "Earned Eligible" : "Not Preferred";
            return `<tr class="${state.ui.selectedVendorId === vendor.id ? "is-selected" : ""}">
              <td><div class="cs-name-cell"><strong>${escapeHtml(vendor.name)}</strong><span>${escapeHtml(vendor.entrataVendorCode || "No Entrata code")}</span></div></td>
              <td>${escapeHtml(asArray(vendor.skills).join(", ") || "No skills")}</td>
              <td>${statusPill(vendor.complianceStatus)}</td>
              <td>${escapeHtml(preferredLabel)}</td>
              <td>${escapeHtml(`${whole(vendor.openWorkOrders)} open / ${whole(vendor.completedWorkOrders)} completed`)}</td>
              <td><div class="cs-name-cell"><strong>${escapeHtml(score)}</strong><span>Q ${escapeHtml(vendor.qualityScore)} / R ${escapeHtml(vendor.reliabilityScore)} / C ${escapeHtml(vendor.costScore)}</span></div></td>
              <td>${escapeHtml(vendorRecommendationReason(vendor))}</td>
              <td class="right"><button type="button" class="cs-btn cs-btn-sm" data-id="${escapeAttr(vendor.id)}" onclick="atlasCsSelectVendor(this.dataset.id)">Open</button></td>
            </tr>`;
          }).join("")}</tbody></table></div>` : `<div class="cs-empty" style="margin-top:12px"><div><strong>No vendor profiles are connected yet.</strong><br>Import active vendor lists or add a vendor profile with Entrata vendor code and skill coverage.</div></div>`}
        </div>
      </div>
      <div class="cs-panel">
        <div class="cs-panel-head"><div><div class="cs-panel-title">Vendor Skill Library</div><div class="cs-panel-sub">Multiple skills can be attached to each vendor and used for future assignment recommendations.</div></div></div>
        <div class="cs-panel-body">
          <div class="cs-chip-row">${state.vendorSkillLibrary.map(skill => `<span class="cs-chip is-strong">${escapeHtml(skill)}</span>`).join("")}</div>
          <div class="cs-control-grid" style="margin-top:12px">
            <label class="cs-field"><span>Add Skill</span><input id="atlas-cs-vendor-skill-new" placeholder="Trade or service"></label>
            <div class="cs-field"><span>&nbsp;</span><button type="button" class="cs-btn" onclick="atlasCsAddVendorSkill()">${icon("plus")} Add Skill</button></div>
          </div>
        </div>
      </div>
    </div>`;
  }

  function renderComplianceSettings(state) {
    return `<div style="display:grid;gap:14px">
      <div class="cs-panel">
        <div class="cs-panel-head">
          <div>
            <div class="cs-panel-title">ATLAS Settings - Compliance - Deposit Accounting by State</div>
            <div class="cs-panel-sub">Legal/Admin users configure state-specific wording, deadlines, delivery rules, documentation rules, versions, and active dates. ATLAS does not use one nationwide legal deadline.</div>
          </div>
        </div>
        <div class="cs-panel-body">
          <div class="cs-control-grid">
            <label class="cs-field"><span>State</span><input id="atlas-cs-compliance-state" maxlength="2" placeholder="FL"></label>
            <label class="cs-field"><span>Deadline Days</span><input id="atlas-cs-compliance-deadline" type="number" min="0" value="0"></label>
            <label class="cs-field"><span>Dispute Window Days</span><input id="atlas-cs-compliance-dispute-window" type="number" min="0" value="0"></label>
            <label class="cs-field"><span>Day Rule</span><select id="atlas-cs-compliance-day-rule">${genericOptionsHtml(["Legal configuration required", "Calendar days", "Business days"], "Legal configuration required")}</select></label>
            <label class="cs-field"><span>Calculation Method</span><input id="atlas-cs-compliance-method" placeholder="Company/legal method"></label>
            <label class="cs-field"><span>Version</span><input id="atlas-cs-compliance-version" value="v1"></label>
            <label class="cs-field"><span>Reviewed By</span><input id="atlas-cs-compliance-reviewed-by" placeholder="Legal reviewer"></label>
            <label class="cs-field" style="grid-column:span 3"><span>Required Statutory Wording</span><textarea id="atlas-cs-compliance-wording" placeholder="Paste approved Legal wording here."></textarea></label>
            <label class="cs-field" style="grid-column:span 3"><span>Delivery / Mailing Rules</span><textarea id="atlas-cs-compliance-delivery" placeholder="Mailing, electronic delivery, certified mail, forwarding address, and documentation rules."></textarea></label>
            <div class="cs-field"><span>&nbsp;</span><button type="button" class="cs-btn cs-btn-primary" onclick="atlasCsAddComplianceRule()">${icon("plus")} Save State Rule</button></div>
          </div>
          ${state.stateComplianceRules.length ? `<div class="cs-table-wrap" style="margin-top:12px"><table class="cs-table"><thead><tr><th>State</th><th>Deadline</th><th>Dispute Window</th><th>Day Rule</th><th>Method</th><th>Delivery</th><th>Reference</th><th>Review</th><th>Status</th></tr></thead><tbody>${state.stateComplianceRules.map(rule => `<tr>
            <td>${escapeHtml(rule.state)}</td>
            <td>${rule.depositAccountingDeadlineDays ? `${escapeHtml(rule.depositAccountingDeadlineDays)} days` : "Not configured"}</td>
            <td>${rule.disputeWindowDays ? `${escapeHtml(rule.disputeWindowDays)} days` : "Not configured"}</td>
            <td>${escapeHtml(rule.dayRule)}</td>
            <td>${escapeHtml(rule.calculationMethod)}</td>
            <td>${escapeHtml(rule.mailingRequirements || rule.electronicDeliveryRules || rule.certifiedMailRequirement || "Not configured")}</td>
            <td>${escapeHtml(rule.statuteReference || "Not listed")}</td>
            <td><div class="cs-name-cell"><strong>${escapeHtml(rule.reviewedBy || "Legal review pending")}</strong><span>${escapeHtml(formatDate(rule.lastReviewedDate) || "No review date")} / ${escapeHtml(rule.version)}</span></div></td>
            <td>${statusPill(rule.active ? "Active" : "Inactive")}</td>
          </tr>`).join("")}</tbody></table></div>` : `<div class="cs-alert is-warn" style="margin-top:12px">No state compliance rules are configured yet. Final resident-facing statements should remain blocked until Legal-approved wording and deadlines are entered.</div>`}
        </div>
      </div>
    </div>`;
  }

  function renderDisputes(state) {
    const disputes = getScopedDisputes(state);
    const selected = disputes.find(item => item.id === state.ui.selectedDisputeId) || disputes[0];
    return `<div class="cs-two-col">
      <div class="cs-panel">
        <div class="cs-panel-head">
          <div>
            <div class="cs-panel-title">Resident Dispute and Revision Workflow</div>
            <div class="cs-panel-sub">Disputes link back to inspection photos, charge history, MORF, statements, approvals, edits, and correspondence.</div>
          </div>
        </div>
        <div class="cs-panel-body">
          ${disputes.length ? `<div class="cs-table-wrap"><table class="cs-table"><thead><tr><th>Resident</th><th>Property / Unit</th><th>Status</th><th>Versions</th><th>Reason</th><th></th></tr></thead><tbody>${disputes.map(dispute => `<tr class="${state.ui.selectedDisputeId === dispute.id ? "is-selected" : ""}">
            <td>${escapeHtml(dispute.residentName)}</td>
            <td>${escapeHtml(dispute.propertyName)} / ${escapeHtml(dispute.unit || "n/a")}</td>
            <td>${statusPill(dispute.status)}</td>
            <td>${escapeHtml(asArray(dispute.versions).length || 1)}</td>
            <td>${escapeHtml(dispute.reason || "Resident review")}</td>
            <td class="right"><button type="button" class="cs-btn cs-btn-sm" data-id="${escapeAttr(dispute.id)}" onclick="atlasCsSelectDispute(this.dataset.id)">Open</button></td>
          </tr>`).join("")}</tbody></table></div>` : `<div class="cs-empty"><div><strong>No resident disputes are open.</strong><br>Create a dispute from a MORF when a statement or charge needs review.</div></div>`}
        </div>
      </div>
      <div class="cs-detail-panel">
        ${selected ? `<div class="cs-detail-title"><div><h3>${escapeHtml(selected.residentName)}</h3><div class="cs-detail-meta">${escapeHtml(selected.propertyName)} - Unit ${escapeHtml(selected.unit || "n/a")}</div></div>${statusPill(selected.status)}</div>
        <div class="cs-section-grid">
          ${[["Original Amount", formatMoney(selected.originalAmount)], ["Current Amount", formatMoney(selected.currentAmount)], ["Statement Version", selected.statementVersion], ["Resident Resent", formatDate(selected.resentAt)], ["Dispute Eligible Through", formatDate(selected.disputeEligibleThrough)]].map(([label, value]) => `<div class="cs-data-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || "Not captured")}</strong></div>`).join("")}
        </div>
        <label class="cs-field"><span>Dispute Status</span><select data-id="${escapeAttr(selected.id)}" onchange="atlasCsUpdateDisputeField(this.dataset.id,'status',this.value)">${statusOptionsHtml(DISPUTE_STATUSES, selected.status)}</select></label>
        <label class="cs-field"><span>Review Notes</span><textarea data-id="${escapeAttr(selected.id)}" onchange="atlasCsUpdateDisputeField(this.dataset.id,'notes',this.value)">${escapeHtml(selected.notes || "")}</textarea></label>
        <div class="cs-chip-row">
          <button type="button" class="cs-btn cs-btn-sm" data-id="${escapeAttr(selected.id)}" onclick="atlasCsAddDisputeVersion(this.dataset.id)">Add Statement Version</button>
          <button type="button" class="cs-btn cs-btn-sm" data-id="${escapeAttr(selected.id)}" onclick="atlasCsCloseDispute(this.dataset.id)">Close Dispute</button>
        </div>
        <div class="cs-field-cluster"><div class="cs-field-cluster-title">Version / Correspondence Audit</div>${renderMiniTimeline([...asArray(selected.versions), ...asArray(selected.correspondence), ...asArray(selected.audit)])}</div>` : `<div class="cs-detail-title"><h3>Dispute Detail</h3></div><div class="cs-alert">Open a dispute to review statement versions and audit history.</div>`}
      </div>
    </div>`;
  }

  function renderArchivedMorfs(state, employees) {
    const statusFilter = cleanString(state.ui.workflowFilter || "all");
    let rows = getScopedArchivedMorfs(state);
    if (ARCHIVE_STATUS_OPTIONS.includes(statusFilter)) {
      rows = rows.filter(morf => morf.archiveStatus === statusFilter);
    }
    return `<div style="display:grid;gap:14px">
      <div class="cs-panel">
        <div class="cs-panel-head">
          <div>
            <div class="cs-panel-title">Archived MORFs / Move-Out Records</div>
            <div class="cs-panel-sub">Post-handoff lifecycle records remain searchable for Accounting follow-up, dispute review, statement versions, charge history, and final closeout.</div>
          </div>
          <button type="button" class="cs-btn cs-btn-sm" onclick="atlasCsSetModule('morfs')">Active MORFs</button>
        </div>
        <div class="cs-panel-body">
          <div class="cs-control-grid" style="margin-bottom:12px">
            <label class="cs-field" style="grid-column:span 4"><span>Archive Search</span><input type="search" value="${escapeAttr(state.ui.search)}" placeholder="Resident, property, unit, MORF ID, inspection ID, processor, send date, refund, balance, dispute status" onchange="atlasCsSetSearch(this.value)"></label>
            <label class="cs-field" style="grid-column:span 2"><span>Archive Status</span><select onchange="atlasCsDrill('archive',this.value)"><option value="all" ${statusFilter === "all" ? "selected" : ""}>All archived records</option>${ARCHIVE_STATUS_OPTIONS.map(status => `<option value="${escapeAttr(status)}" ${statusFilter === status ? "selected" : ""}>${escapeHtml(status)}</option>`).join("")}</select></label>
          </div>
          ${rows.length ? `<div class="cs-table-wrap">
            <table class="cs-table">
              <thead><tr><th>Resident</th><th>Property / Unit</th><th>Move-Out</th><th>MORF / Inspection</th><th>Processor</th><th>Accounting Sent</th><th>Refund / Balance</th><th>Dispute</th><th>Archive Status</th><th></th></tr></thead>
              <tbody>
                ${rows.map(morf => {
                  const totals = getMorfTotals(morf);
                  const handoff = asObject(morf.accountingHandoff);
                  const dispute = state.residentDisputes.find(row => row.morfId === morf.id);
                  const eligibility = getDisputeEligibility(state, morf);
                  return `<tr>
                    <td><div class="cs-name-cell"><strong>${escapeHtml(morf.residentName)}</strong><span>${escapeHtml(morf.email || "Resident email pending")}</span></div></td>
                    <td><div class="cs-name-cell"><strong>${escapeHtml(morf.propertyName)}</strong><span>Unit ${escapeHtml(morf.unit || "n/a")}</span></div></td>
                    <td>${escapeHtml(formatDate(morf.possessionReturnedDate || morf.moveOutDate) || "Not captured")}</td>
                    <td><div class="cs-name-cell"><strong>${escapeHtml(morf.id)}</strong><span>${escapeHtml(morf.inspectionId || "Inspection ID pending")}</span></div></td>
                    <td>${escapeHtml(morf.processor || defaultOwner(employees))}</td>
                    <td>${escapeHtml(formatDate(handoff.sentAt || morf.accountingSentAt || morf.archivedAt) || "Not timestamped")}</td>
                    <td><div class="cs-name-cell"><strong>${escapeHtml(formatMoney(totals.balanceDueToResident) || "$0")} refund</strong><span>${escapeHtml(formatMoney(totals.balanceDueToProperty) || "$0")} balance</span></div></td>
                    <td><div class="cs-name-cell"><strong>${escapeHtml(dispute?.status || morf.disputeStatus || "No dispute")}</strong><span>${escapeHtml(eligibility.through ? `Eligible through ${formatDate(eligibility.through)}` : eligibility.label)}</span></div></td>
                    <td><select data-id="${escapeAttr(morf.id)}" onchange="atlasCsUpdateArchivedMorfStatus(this.dataset.id,this.value)">${statusOptionsHtml(ARCHIVE_STATUS_OPTIONS, morf.archiveStatus || "Sent to Accounting / Open")}</select></td>
                    <td class="right">
                      <button type="button" class="cs-btn cs-btn-sm" data-id="${escapeAttr(morf.id)}" onclick="atlasCsSelectMorf(this.dataset.id)">Open MORF</button>
                      <button type="button" class="cs-btn cs-btn-sm" data-id="${escapeAttr(morf.id)}" onclick="atlasCsCreateDisputeFromMorf(this.dataset.id)" ${eligibility.eligible ? "" : "disabled"}>Open Dispute</button>
                    </td>
                  </tr>`;
                }).join("")}
              </tbody>
            </table>
          </div>` : `<div class="cs-empty"><div><strong>No archived MORFs match this view.</strong><br>Finalize a MORF and send it to Accounting to move it into this searchable repository.</div></div>`}
        </div>
      </div>
    </div>`;
  }

  function renderTasks(state) {
    return `<div class="cs-panel">
      <div class="cs-panel-head">
        <div>
          <div class="cs-panel-title">Central Services Work Queue</div>
          <div class="cs-panel-sub">Consolidated tasks generated from real Central Services workflow records.</div>
        </div>
      </div>
      <div class="cs-panel-body">${renderTaskTable(state)}</div>
    </div>`;
  }

  function renderAccountingContacts(state) {
    const contacts = state.accountingContacts;
    return `<div class="cs-panel">
      <div class="cs-panel-head">
        <div>
          <div class="cs-panel-title">Accounting Transmittal Contacts</div>
          <div class="cs-panel-sub">No accounting recipients are seeded. Add the real routing contacts here before using Send to Accounting.</div>
        </div>
      </div>
      <div class="cs-panel-body">
        <div class="cs-control-grid" style="margin-bottom:12px">
          <label class="cs-field"><span>Property</span><select id="atlas-cs-accounting-property">${propertyOptionsHtml("all", true)}</select></label>
          <label class="cs-field"><span>Name</span><input id="atlas-cs-accounting-name" placeholder="Contact name"></label>
          <label class="cs-field"><span>Email</span><input id="atlas-cs-accounting-email" type="email" placeholder="name@company.com"></label>
          <label class="cs-field"><span>Role</span><input id="atlas-cs-accounting-role" placeholder="Accounting, AP, AR, etc."></label>
          <div class="cs-field"><span>&nbsp;</span><button type="button" class="cs-btn cs-btn-primary" onclick="atlasCsAddAccountingContact()">${icon("plus")} Add Contact</button></div>
        </div>
        ${contacts.length ? `<div class="cs-table-wrap"><table class="cs-table"><thead><tr><th>Contact</th><th>Property Scope</th><th>Role</th><th></th></tr></thead><tbody>${contacts.map(contact => `<tr><td><div class="cs-name-cell"><strong>${escapeHtml(contact.name)}</strong><span>${escapeHtml(contact.email)}</span></div></td><td>${escapeHtml(contact.propertyName === "all" ? "All properties" : contact.propertyName)}</td><td>${escapeHtml(contact.role || "Not listed")}</td><td class="right"><button type="button" class="cs-btn cs-btn-sm cs-btn-danger" data-id="${escapeAttr(contact.id)}" onclick="atlasCsDeleteAccountingContact(this.dataset.id)">Remove</button></td></tr>`).join("")}</tbody></table></div>` : `<div class="cs-empty"><div><strong>No accounting contacts configured.</strong><br>Add real routing contacts before sending MORF/SODA or final-accounting work from Central Services.</div></div>`}
      </div>
    </div>`;
  }

  function renderCentralDashboardActiveWidgetManager(state) {
    const widgets = getCentralDashboardWidgets(state);
    return `<div class="cs-dashboard-manager-list">
      ${widgets.map(widget => {
        const definition = getCentralDashboardWidgetDefinition(widget.widgetKey) || {};
        return `<div class="cs-dashboard-manager-row">
          <div>
            <strong>${escapeHtml(definition.label || widget.widgetKey)}</strong>
            <span>${escapeHtml([widget.visualization, widget.dateRange, widget.propertyScope, widget.sortOrder].filter(Boolean).join(" / "))}</span>
          </div>
          <div class="cs-dashboard-widget-toolbar">
            <button type="button" class="cs-icon-btn" title="Move earlier" onclick="atlasCsDashboardMoveWidget('${escapeAttr(widget.instanceId)}',-1)">${icon("arrow-up")}</button>
            <button type="button" class="cs-icon-btn" title="Move later" onclick="atlasCsDashboardMoveWidget('${escapeAttr(widget.instanceId)}',1)">${icon("arrow-down")}</button>
            <button type="button" class="cs-icon-btn" title="Configure" onclick="atlasCsDashboardEditWidget('${escapeAttr(widget.instanceId)}')">${icon("sliders-horizontal")}</button>
            <button type="button" class="cs-icon-btn" title="Remove" onclick="atlasCsDashboardRemoveWidget('${escapeAttr(widget.instanceId)}')">${icon("trash")}</button>
            <span class="cs-dashboard-size-group">${CENTRAL_DASHBOARD_WIDGET_SIZES.map(([size, label]) => `<button type="button" class="${widget.size === size ? "is-active" : ""}" onclick="atlasCsDashboardSetWidgetSize('${escapeAttr(widget.instanceId)}','${escapeAttr(size)}')">${escapeHtml(label)}</button>`).join("")}</span>
          </div>
          ${state.ui.dashboardConfigId === widget.instanceId ? renderCentralDashboardWidgetConfig(state, widget) : ""}
        </div>`;
      }).join("")}
    </div>`;
  }

  function renderCentralDashboardPreferencesPanel(state, employees) {
    const prefs = getCentralDashboardPreferences(state);
    const user = currentActor();
    const canManageGlobal = currentUserCanManageGlobalDashboardDefault();
    return `<div class="cs-panel" id="atlas-cs-dashboard-preferences">
      <div class="cs-panel-head">
        <div>
          <div class="cs-panel-title">Dashboard Preferences - Central Services</div>
          <div class="cs-panel-sub">Personal Central Services dashboard for ${escapeHtml(user.name || "this user")}. Restore affects this user's view only${canManageGlobal ? "; administrators can later promote a layout to a global default when central storage supports it" : ""}.</div>
        </div>
        <div class="cs-command-actions">
          <button type="button" class="cs-btn cs-btn-sm" onclick="atlasCsSetModule('overview')">${icon("squares-four")} Open Dashboard</button>
          <button type="button" class="cs-btn cs-btn-sm" onclick="atlasCsDashboardToggleLibrary()">${icon("plus")} ${prefs.libraryOpen ? "Hide Add Widget" : "Add Widget"}</button>
          <button type="button" class="cs-btn cs-btn-sm" onclick="atlasCsDashboardSaveView()">${icon("floppy-disk")} Save View</button>
          <button type="button" class="cs-btn cs-btn-sm" onclick="atlasCsDashboardRestoreDefault()">${icon("arrow-counter-clockwise")} Restore Central Services Default</button>
        </div>
      </div>
      <div class="cs-panel-body">
        <div class="cs-dashboard-signal-row">
          <span>${escapeHtml(prefs.widgets.length)} active widgets</span>
          <span>Saved ${escapeHtml(prefs.savedAt ? formatDate(prefs.savedAt) || prefs.savedAt : "locally")}</span>
          <span>People roster remains the employee source of truth</span>
        </div>
        ${renderCentralDashboardActiveWidgetManager(state)}
        ${prefs.libraryOpen ? renderCentralDashboardWidgetLibrary(state) : ""}
      </div>
    </div>`;
  }

  function renderSettings(state, employees) {
    return `<div style="display:grid;gap:14px">
      <div class="cs-panel">
        <div class="cs-panel-head">
          <div>
            <div class="cs-panel-title">Workflow Settings</div>
            <div class="cs-panel-sub">Operational settings are configurable here; state-specific legal settings live in the Compliance module.</div>
          </div>
        </div>
        <div class="cs-panel-body">
          <div class="cs-control-grid">
            <label class="cs-field"><span>Internal MORF SLA</span><input id="atlas-cs-setting-morf-days" type="number" min="1" value="${escapeAttr(state.workflowSettings.morfInternalBusinessDays)}" onchange="atlasCsUpdateWorkflowSetting('morfInternalBusinessDays',this.value)"></label>
            <label class="cs-field"><span>Default ZIP Multiplier</span><input id="atlas-cs-setting-market-multiplier" type="number" min="0.1" step="0.01" value="${escapeAttr(state.workflowSettings.defaultMarketZipMultiplier)}" onchange="atlasCsUpdateWorkflowSetting('defaultMarketZipMultiplier',this.value)"></label>
            <label class="cs-field"><span>Dispute Review Days</span><input id="atlas-cs-setting-lock-days" type="number" min="0" value="${escapeAttr(state.workflowSettings.lockReviewBusinessDays)}" onchange="atlasCsUpdateWorkflowSetting('lockReviewBusinessDays',this.value)"></label>
            <label class="cs-field"><span>Mailing Buffer Days</span><input id="atlas-cs-setting-mail-buffer" type="number" min="0" value="${escapeAttr(state.workflowSettings.mailingBufferBusinessDays)}" onchange="atlasCsUpdateWorkflowSetting('mailingBufferBusinessDays',this.value)"></label>
            <label class="cs-field" style="grid-column:span 2"><span>Company Holidays</span><input id="atlas-cs-setting-holidays" value="${escapeAttr(asArray(state.workflowSettings.companyHolidays).join(", "))}" placeholder="2026-09-07, 2026-11-26" onchange="atlasCsUpdateWorkflowSetting('companyHolidays',this.value)"></label>
            <label class="cs-field" style="grid-column:span 2"><span>Inspection-Eligible Roles</span><input id="atlas-cs-setting-inspection-roles" value="${escapeAttr(asArray(state.workflowSettings.inspectionEligibleRoleSignals).join(", "))}" placeholder="Maintenance Supervisor, Service Technician" onchange="atlasCsUpdateWorkflowSetting('inspectionEligibleRoleSignals',this.value)"></label>
          </div>
        </div>
      </div>
      ${renderCentralDashboardPreferencesPanel(state, employees)}
      <div class="cs-panel">
        <div class="cs-panel-head">
          <div>
            <div class="cs-panel-title">Central Services Employees</div>
            <div class="cs-panel-sub">Sourced from the employee roster page using Centra or Central Services department signals.</div>
          </div>
        </div>
        <div class="cs-panel-body">${renderRosterPanel(employees)}</div>
      </div>
      <div class="cs-panel">
        <div class="cs-panel-head">
          <div>
            <div class="cs-panel-title">Inspection Libraries</div>
            <div class="cs-panel-sub">Rooms, components, common-area types, and vendor skills feed dropdowns in the mobile-first inspection flow.</div>
          </div>
        </div>
        <div class="cs-panel-body">
          <div class="cs-architecture-grid">
            <div class="cs-architecture-item"><h3>Rooms</h3><p>${escapeHtml(state.roomLibrary.join(", "))}</p><div class="cs-control-grid" style="margin-top:10px"><label class="cs-field"><span>Add Room</span><input id="atlas-cs-room-new" placeholder="Room or area"></label><div class="cs-field"><span>&nbsp;</span><button type="button" class="cs-btn cs-btn-sm" onclick="atlasCsAddRoomLibraryItem()">Add</button></div></div></div>
            <div class="cs-architecture-item"><h3>Components</h3><p>${escapeHtml(state.componentLibrary.join(", "))}</p><div class="cs-control-grid" style="margin-top:10px"><label class="cs-field"><span>Add Component</span><input id="atlas-cs-component-new" placeholder="Component"></label><div class="cs-field"><span>&nbsp;</span><button type="button" class="cs-btn cs-btn-sm" onclick="atlasCsAddComponentLibraryItem()">Add</button></div></div></div>
          </div>
        </div>
      </div>
      ${renderAccountingContacts(state)}
    </div>`;
  }

  function renderArchitecture(state) {
    const entities = SYSTEM_RELATIONSHIP_CHAIN.map(label => `<div class="cs-entity"><strong>${escapeHtml(label)}</strong><span>Shared ATLAS record with source IDs, version history, and audit events.</span></div>`).join("");
    const architectureSections = [
      {
        title: "MORF Lifecycle State Machine",
        items: [
          "Renewal Tracker On Notice and Notice to Vacate rows create one persistent Move-Out Lifecycle Record.",
          "Normal path: On Notice -> Upcoming Move Out -> Possession Confirmed -> Move-Out Inspection -> Inspection Approval -> MORF Ready -> MORF In Progress -> MORF Finalized -> Sent to Accounting -> Archived / Open -> MORF Closed.",
          "Holdover path: Upcoming Move Out -> Hold Over / Past Due Move Out -> Inspection Hold - Possession Not Returned -> Resident Notification / Date Adjustment / Memo -> Possession Confirmed -> Move-Out Inspection.",
          "Scheduled move-out date is used for planning; actual possession returned date is required for MORF deadlines and state compliance calculations.",
          "Duplicate uploads do not overwrite workflow, inspection, MORF, approvals, memos, or audit history; conflicting source data becomes a Potential Record Update."
        ]
      },
      {
        title: "Existing Components To Reuse",
        items: [
          "ATLAS property/community setup, address, market, unit counts, active status, and floor-plan data.",
          "People roster and shared employee assignment graph for inspectors, reviewers, Central Services processors, regionals, administrators, and in-house technicians.",
          "Central Services renewal import and NTV-to-move-out case creation.",
          "Existing move-out workflow, MOG status, accounting contacts, task queue, import history, and audit trail.",
          "Maintenance inspection import tables for Moonrise MSOE/SOE visibility, without replacing Moonrise."
        ]
      },
      {
        title: "Existing Tables To Reuse",
        items: [
          "atlas_communities for property identity and state/address matching.",
          "atlas_employees, atlas_roles, and assignment tables for user/role resolution.",
          "atlas_contracts as an initial vendor-name source until normalized vendors are added.",
          "atlas_maintenance_inspections for Moonrise inspection snapshots and reporting context.",
          "atlas_audit_log, atlas_app_documents, atlas_app_document_versions, atlas_mapping_log, and atlas_legacy_snapshots for audit, versioning, and migration safety."
        ]
      },
      {
        title: "New Tables Required",
        items: [
          "atlas_inspection_templates, atlas_inspections, atlas_inspection_sections, atlas_inspection_findings, atlas_inspection_photos, atlas_photo_annotations, atlas_inspection_signatures.",
          "atlas_chargeback_catalog, atlas_chargeback_property_overrides, atlas_chargeback_useful_life_policies, atlas_resident_responsibility_reviews, atlas_morf_charges.",
          "atlas_move_out_morfs, atlas_morf_ledger_lines, atlas_deposit_accounting_statements, atlas_statement_versions, atlas_statement_delivery_events.",
          "atlas_state_deposit_accounting_rules, atlas_accounting_routing_rules, atlas_resident_disputes, atlas_dispute_events.",
          "atlas_vendors, atlas_vendor_skills, atlas_vendor_property_preferences, atlas_vendor_assignments, atlas_vendor_score_events, atlas_vendor_infractions, atlas_vendor_feedback."
        ]
      },
      {
        title: "New Relationships",
        items: [
          "Community -> Building -> Floor -> Unit -> Resident -> Lease -> Move-Out -> Inspection -> Findings.",
          "Finding -> Resident Responsibility Review -> Charge Recommendation -> MORF Charge -> Statement Line.",
          "Move-Out -> MORF -> Statement Version -> Accounting Packet -> Delivery Tracking -> Dispute.",
          "Finding -> Corrective Action -> Work Task -> In-house Employee or Vendor Assignment.",
          "Vendor -> Skills -> Assignments -> Work Orders -> Quality / Callback / Infraction / Resident Feedback score history."
        ]
      },
      {
        title: "Object Models",
        items: [
          "Inspection: template, location, rooms, findings, photos, annotations, AI suggestions, decisions, signatures, sync status, review status, audit.",
          "MORF: move-out identity, resident/prepopulated lease fields, possession date, internal due, state legal deadline, MOG sources, ledger lines, charges, packet selections, statement versions, delivery tracking, accounting status.",
          "Chargeback catalog: portfolio cost, market multiplier, property override, labor/material split, useful life, depreciation method, charge type, effective dates, updater, active flag.",
          "Vendor performance: vendor code, skills, property/market service area, compliance, work history, response/completion time, callbacks, infractions, satisfaction, score components, preferred-status evidence.",
          "Compliance/dispute: state rule versions, legal wording, delivery rules, review metadata, dispute versions, adjustments, correspondence, lock/reopen audit."
        ]
      },
      {
        title: "Offline Sync And Mobile API",
        items: [
          "Mobile stores draft/submitted inspections locally with photos, notes, conditions, charges, signatures, location context, and a device inspection ID.",
          "Sync queue moves through Saved Offline, Waiting to Sync, Syncing, Successfully Synced, or Sync Error - Action Required.",
          "Dedupe keys should combine source inspection ID, device inspection ID, updated timestamp, and record version to avoid duplicate records after reconnection.",
          "API endpoints should support templates, property/unit lookup, inspection save/submit, photo upload, annotation save, signature capture, MORF handoff, task assignment, and sync conflict resolution.",
          "Future native features can add camera, video, speech-to-text, background sync, QR/barcode, location-aware property selection, push notifications, and AI image recognition."
        ]
      },
      {
        title: "Entrata And Accounting Integration Points",
        items: [
          "Entrata renewal export already seeds resident-level NTV and move-out cases.",
          "Future Entrata API reads should populate residents, leases, units, deposits, final utilities, recurring charges, rent owed, credits, payments, and balances.",
          "Entrata vendor codes should map into normalized vendor profiles and assignment history.",
          "Accounting routing should use Portfolio Default -> Ownership Group -> State -> Property Override, with authorized editable recipients.",
          "Accounting packet attachments should be selected through a pre-send checklist rather than attached automatically."
        ]
      },
      {
        title: "Security, Privacy, And Risks",
        items: [
          "Resident financial obligations, photos, signatures, forwarding addresses, and correspondence require role-based access, encryption in transit/at rest, and retention controls.",
          "Resident-attended inspection copies must suppress predetermined, estimated, recommended, or standard dollar amounts.",
          "AI suggestions stay advisory only and must record suggestion, confidence, human decision, and final classification.",
          "Legal deadlines and statutory wording must come from Legal-approved state configuration, not hard-coded assumptions.",
          "Migration risks are duplicate resident/unit/vendor records, local browser storage limits for photos, stale offline sync conflicts, unreviewed legal wording, and whole-document overwrite behavior before central table cutover."
        ]
      },
      {
        title: "Recommended Phases",
        items: [
          "Phase 1: core inspection templates, rooms, photos, signatures, RISE reports, mobile-responsive field workflow.",
          "Phase 2: chargeback catalog, ZIP multiplier, property overrides, useful life, photo requirements, audit trail.",
          "Phase 3: move-out trigger, MORF queue, inspection-to-MORF charges, MOG integration, accounting handoff.",
          "Phase 4: deposit accounting statements, state rules, delivery tracking, legal deadlines, statement versions, auto-lock.",
          "Phase 5: vendor skills, preferred status, assignment recommendations, workload, quality history, scoring.",
          "Phase 6: AI inspection suggestions with human confirmation only.",
          "Phase 7: native/offline-first mobile application using the same APIs and records."
        ]
      }
    ];
    return `<div style="display:grid;gap:14px">
      <div class="cs-panel">
        <div class="cs-panel-head">
          <div>
            <div class="cs-panel-title">ATLAS Mobile Inspection, MORF, Chargeback, and Vendor Quality Architecture</div>
            <div class="cs-panel-sub">This expands Central Services without rebuilding working ATLAS functionality or duplicating source-of-truth property, resident, employee, vendor, and work-order records.</div>
          </div>
          <button type="button" class="cs-btn cs-btn-sm" onclick="atlasCsSetModule('inspections')">Open Inspection Engine</button>
        </div>
        <div class="cs-panel-body"><div class="cs-entity-map">${entities}</div></div>
      </div>
      <div class="cs-architecture-grid">
        ${architectureSections.map(section => `<div class="cs-architecture-item"><h3>${escapeHtml(section.title)}</h3><ul>${section.items.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>`).join("")}
      </div>
    </div>`;
  }

  function renderQuestions() {
    const questions = [
      "Which exact employee roster department values should count as Central Services or Centra?",
      "Should Central Services include inactive/retired ATLAS properties, or only active communities?",
      "Which Entrata renewal, ledger, resident, unit, and vendor fields should become source-of-truth integration keys?",
      "Which roles can submit, review, approve, override photo requirements, edit final MORF charges, reopen locked records, and manage Legal wording?",
      "Which state deposit-accounting rules and approved statutory wording should Legal load first?",
      "What are the photo retention, offline device storage, and resident privacy requirements for field use?",
      "Which accounting packet attachments should be required, optional, or blocked by property/ownership group?",
      "Which active vendor list and Entrata vendor-code export should seed the vendor profile migration?",
      "Which AI inspection suggestions should be piloted first, and what confidence/approval rules should govern them?"
    ];
    return `<div class="cs-panel">
      <div class="cs-panel-head">
        <div>
          <div class="cs-panel-title">Build Questions</div>
          <div class="cs-panel-sub">These are the remaining business and compliance decisions needed before the mobile/offline system becomes production-controlled.</div>
        </div>
      </div>
      <div class="cs-panel-body">
        <div class="cs-architecture-grid">
          ${questions.map((question, idx) => `<div class="cs-architecture-item"><h3>${idx + 1}. ${escapeHtml(question)}</h3><p>Answering this lets ATLAS turn the configured workflow into governed production behavior.</p></div>`).join("")}
        </div>
      </div>
    </div>`;
  }

  function renderImportHistory(state) {
    if (!state.importHistory.length) return "";
    return `<div class="cs-alert">
      Last import: ${escapeHtml(state.importHistory[0].propertyName)} - ${escapeHtml(state.importHistory[0].fileName)} - ${escapeHtml(state.importHistory[0].rowCount)} rows - ${escapeHtml(formatDate(state.importHistory[0].importedAt) || state.importHistory[0].importedAt)}
    </div>`;
  }

  function renderModule(state, employees) {
    if (state.ui.module === "renewals") return renderRenewals(state, employees);
    if (state.ui.module === "moveOuts") return renderMoveOuts(state, employees);
    if (state.ui.module === "inspections") return renderInspections(state, employees);
    if (state.ui.module === "morfs") return renderMorfs(state, employees);
    if (state.ui.module === "chargebacks") return renderChargebackCatalog(state);
    if (state.ui.module === "collections") return renderEmptyWorkflowModule(state, {
      key: "collections",
      title: "Delinquency & Collections",
      sub: "Waiting on the real delinquency source, ownership rules, and follow-up cadence.",
      empty: "No collection records are connected. This module will stay empty until the source report or system integration is defined."
    });
    if (state.ui.module === "evictions") return renderEmptyWorkflowModule(state, {
      key: "evictions",
      title: "Evictions",
      sub: "Waiting on legal status source, role permissions, and attorney/court workflow rules.",
      empty: "No eviction records are connected. Once the source and stages are confirmed, drilldowns can become real legal workflow records."
    });
    if (state.ui.module === "vendors") return renderVendorProfiles(state);
    if (state.ui.module === "invoices") return renderEmptyWorkflowModule(state, {
      key: "invoices",
      title: "Invoice Processing",
      sub: "Waiting on invoice intake source, PO matching rules, and approval routing.",
      empty: "No invoice records are connected. Add the source and routing rules before invoice buttons are wired."
    });
    if (state.ui.module === "compliance") return renderComplianceSettings(state);
    if (state.ui.module === "disputes") return renderDisputes(state);
    if (state.ui.module === "archive") return renderArchivedMorfs(state, employees);
    if (state.ui.module === "tasks") return renderTasks(state);
    if (state.ui.module === "settings") return renderSettings(state, employees);
    if (state.ui.module === "architecture") return renderArchitecture(state);
    if (state.ui.module === "questions") return renderQuestions(state);
    return renderOverview(state, employees);
  }

  function renderCentralServices() {
    const state = loadState();
    const employees = getCentralServicesEmployees();
    const monthLabel = MONTH_LABELS[selectedMonthIdx(state)];
    return `<div class="cs-page">
      <div class="cs-command-header">
        <div>
          <div class="cs-kicker">ATLAS Central Services</div>
          <div class="cs-command-title">Central Services Workspace</div>
          <div class="cs-command-copy">This workspace compiles live ATLAS portfolio data across all selected properties and uses the employee roster to identify Central Services team members. It does not display seeded residents, fake contacts, or mock tasks. Workflow records appear only after a real import or a user action creates them.</div>
          <div class="cs-chip-row" style="margin-top:10px">
            <span class="cs-chip is-strong">${escapeHtml(monthLabel)} ${escapeHtml(selectedYear(state))}</span>
            <span class="cs-chip">${escapeHtml(state.ui.propertyId === "all" ? "All ATLAS properties" : state.ui.propertyId)}</span>
            <span class="cs-chip">${escapeHtml(employees.length)} roster employees</span>
          </div>
        </div>
        <div class="cs-command-actions">
          <button type="button" class="cs-btn" onclick="atlasCsSetModule('architecture')">${icon("blueprint")} Architecture</button>
          <button type="button" class="cs-btn" onclick="atlasCsExportData()">${icon("download-simple")} Export Data</button>
          <button type="button" class="cs-btn cs-btn-primary" onclick="atlasCsSetModule('questions')">${icon("question")} Build Questions</button>
        </div>
      </div>
      ${renderModuleNav(state)}
      ${renderControls(state)}
      ${renderImportHistory(state)}
      ${!employees.length ? `<div class="cs-alert is-warn">Central Services ownership is currently unassigned because no active employees in the roster match Centra or Central Services department fields.</div>` : ""}
      ${renderModule(state, employees)}
    </div>`;
  }

  function getImportControlValue(id) {
    return cleanString(document.getElementById(id)?.value);
  }

  function parseCsvRows(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let inQuotes = false;
    const source = String(text || "");
    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];
      const next = source[index + 1];
      if (char === '"' && inQuotes && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        row.push(cell);
        cell = "";
      } else if ((char === "\n" || char === "\r") && !inQuotes) {
        if (char === "\r" && next === "\n") index += 1;
        row.push(cell);
        if (row.some(value => cleanString(value))) rows.push(row);
        row = [];
        cell = "";
      } else {
        cell += char;
      }
    }
    row.push(cell);
    if (row.some(value => cleanString(value))) rows.push(row);
    return rows;
  }

  function findHeaderIndex(rows) {
    return rows.findIndex(row => {
      const keys = row.map(normalizeKey);
      const joined = keys.join(" ");
      return /(resident|tenant|name)/.test(joined) && /(unit|apartment|apt)/.test(joined) && /(expiration|lease end|expire)/.test(joined);
    });
  }

  function rowsToObjects(rows) {
    const headerIndex = findHeaderIndex(rows);
    if (headerIndex < 0) return [];
    const headers = rows[headerIndex].map(header => normalizeKey(header));
    return rows.slice(headerIndex + 1).map(row => {
      const object = {};
      headers.forEach((header, idx) => {
        if (header) object[header] = row[idx];
      });
      if (row?.__atlasRenewalVisualStatus) object.__atlasRenewalVisualStatus = row.__atlasRenewalVisualStatus;
      if (row?.__atlasRenewalHighlightedNtv) object.__atlasRenewalHighlightedNtv = true;
      return object;
    }).filter(row => Object.values(row).some(value => cleanString(value)));
  }

  function findAliasedValue(row, fieldName) {
    const aliases = RENEWAL_FIELD_ALIASES[fieldName] || [];
    const directKeys = [
      fieldName,
      fieldName.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`),
      normalizeKey(fieldName)
    ];
    for (const key of directKeys) {
      if (row[key] !== undefined && cleanString(row[key])) return row[key];
    }
    for (const alias of aliases) {
      const key = normalizeKey(alias);
      if (row[key] !== undefined && cleanString(row[key])) return row[key];
    }
    return "";
  }

  function yesValue(value) {
    const normalized = normalizeKey(value);
    return ["yes", "y", "true", "signed", "received", "x", "1"].includes(normalized);
  }

  function realTrackerEntry(value) {
    const text = cleanString(value);
    if (!text) return false;
    return !/^(?:0|no|n\/a|na|select|▼\s*enter|◀\s*auto)$/i.test(text);
  }

  function renewalRowMarkedNtv(row) {
    return cleanString(row?.__atlasRenewalVisualStatus).toLowerCase() === "ntv" || row?.__atlasRenewalHighlightedNtv === true;
  }

  function inferRenewalStatus(row) {
    const explicit = cleanString(findAliasedValue(row, "status"));
    if (explicit) return explicit;
    if (yesValue(findAliasedValue(row, "renewalSigned")) || realTrackerEntry(findAliasedValue(row, "renewalSigned"))) return "Renewal Signed";
    if (yesValue(findAliasedValue(row, "transfer")) || realTrackerEntry(findAliasedValue(row, "transfer"))) return "Transfer";
    if (renewalRowMarkedNtv(row) || yesValue(findAliasedValue(row, "ntvReceived")) || realTrackerEntry(findAliasedValue(row, "ntvReceived")) || normalizeDate(findAliasedValue(row, "ntvReceivedDate"))) return "NTV Received";
    return "Pending Decision";
  }

  function mapRenewalRecord(row, context, employees) {
    const residentName = cleanString(findAliasedValue(row, "residentName"));
    const unit = cleanString(findAliasedValue(row, "unit"));
    const expirationDate = normalizeDate(findAliasedValue(row, "expirationDate"));
    if (!residentName || !unit || !expirationDate) return null;
    const importedAt = cleanString(row.importedAt || row.imported_at) || new Date().toISOString();
    const sourceFileName = cleanString(row.sourceFileName || row.source_file_name || context.fileName);
    const residentId = cleanString(findAliasedValue(row, "residentId"));
    const leaseId = cleanString(findAliasedValue(row, "leaseId"));
    const ntvReceivedDate = normalizeDate(findAliasedValue(row, "ntvReceivedDate")) || normalizeDate(findAliasedValue(row, "ntvReceived"));
    const id = makeId("renewal", [
      context.propertyName,
      residentId,
      leaseId,
      residentName,
      unit,
      expirationDate
    ]);
    const status = inferRenewalStatus(row);
    return {
      id,
      source: "renewal_import",
      sourceFileName,
      importedAt,
      propertyName: context.propertyName,
      monthIdx: context.monthIdx,
      year: context.year,
      periodKey: localPeriodKey(context.monthIdx, context.year),
      residentName,
      residentId,
      leaseId,
      unit,
      unitType: cleanString(findAliasedValue(row, "unitType")),
      moveInDate: normalizeDate(findAliasedValue(row, "moveInDate")),
      expirationDate,
      notice90Date: normalizeDate(findAliasedValue(row, "notice90Date")),
      notice60Date: normalizeDate(findAliasedValue(row, "notice60Date")),
      notice30Date: normalizeDate(findAliasedValue(row, "notice30Date")),
      depositHeld: numberValue(findAliasedValue(row, "depositHeld")),
      currentRate: numberValue(findAliasedValue(row, "currentRate")),
      recommendedOffer: numberValue(findAliasedValue(row, "recommendedOffer")),
      investorOverridePct: numberValue(findAliasedValue(row, "investorOverridePct")),
      investorOverrideOffer: numberValue(findAliasedValue(row, "investorOverrideOffer")),
      offer1: numberValue(findAliasedValue(row, "offer1")),
      offer2: numberValue(findAliasedValue(row, "offer2")),
      offer3: numberValue(findAliasedValue(row, "offer3")),
      signedOffer: numberValue(findAliasedValue(row, "signedOffer")),
      ntvReceivedDate,
      scheduledMoveOutDate: normalizeDate(findAliasedValue(row, "scheduledMoveOutDate")),
      phone: cleanString(findAliasedValue(row, "phone")),
      email: cleanString(findAliasedValue(row, "email")).toLowerCase(),
      forwardingAddress: cleanString(findAliasedValue(row, "forwardingAddress")),
      assignedRegional: cleanString(findAliasedValue(row, "assignedRegional")),
      assignedCentralServicesUser: cleanString(findAliasedValue(row, "assignedCentralServicesUser")),
      communityEmail: cleanString(findAliasedValue(row, "communityEmail")).toLowerCase(),
      notes: cleanString(findAliasedValue(row, "notes")),
      marketRate: numberValue(findAliasedValue(row, "marketRate")),
      budgetRate: numberValue(findAliasedValue(row, "budgetRate")),
      occupancyPosition: cleanString(findAliasedValue(row, "occupancyPosition")),
      rentGrowthOffer1: numberValue(findAliasedValue(row, "rentGrowthOffer1")),
      rentGrowthOffer2: numberValue(findAliasedValue(row, "rentGrowthOffer2")),
      rentGrowthOffer3: numberValue(findAliasedValue(row, "rentGrowthOffer3")),
      signedRentGrowth: cleanString(findAliasedValue(row, "signedRentGrowth")),
      status,
      owner: cleanString(findAliasedValue(row, "assignedCentralServicesUser")) || defaultOwner(employees),
      nextAction: status === "NTV Received" ? "Create move-out workflow" : "Review renewal decision",
      dueDate: normalizeDate(findAliasedValue(row, "notice30Date")) || normalizeDate(findAliasedValue(row, "notice60Date")) || normalizeDate(findAliasedValue(row, "notice90Date")) || expirationDate,
      activity: asArray(row.activity).length
        ? asArray(row.activity)
        : [{
            at: importedAt,
            label: `Imported from ${sourceFileName || "Renewal Tracker upload"}`
          }]
    };
  }

  function mapRenewalRows(rows, context, employees) {
    const sourceRows = asArray(rows);
    const objectRows = Array.isArray(sourceRows[0]) ? rowsToObjects(sourceRows) : sourceRows;
    return objectRows.map(row => mapRenewalRecord(row, context, employees)).filter(Boolean);
  }

  async function parseRenewalFile(file, context, employees) {
    const lower = cleanString(file.name).toLowerCase();
    let rows = [];
    if (lower.endsWith(".csv")) {
      rows = rowsToObjects(parseCsvRows(await file.text()));
    } else {
      if (typeof XLSX === "undefined") throw new Error("The spreadsheet parser is not available in this ATLAS session.");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true, cellStyles: true });
      workbook.SheetNames.forEach(sheetName => {
        const rawRows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "", raw: false, blankrows: true });
        const sheetRows = typeof window !== "undefined" && typeof window.annotateRenewalRowsWithWorkbookVisualStatus === "function"
          ? window.annotateRenewalRowsWithWorkbookVisualStatus(rawRows, workbook.Sheets[sheetName])
          : rawRows;
        rows = rows.concat(rowsToObjects(sheetRows));
      });
    }
    return mapRenewalRows(rows, context, employees);
  }

  function upsertRenewals(state, rows) {
    const byId = new Map(state.renewals.map(row => [row.id, row]));
    rows.forEach(row => {
      const existing = byId.get(row.id);
      const activity = [...asArray(existing?.activity), ...asArray(row.activity)]
        .filter((item, index, all) => item && all.findIndex(candidate => cleanString(candidate?.at) === cleanString(item.at) && cleanString(candidate?.label) === cleanString(item.label)) === index)
        .slice(-50);
      byId.set(row.id, {
        ...existing,
        ...row,
        owner: existing?.owner && existing.owner !== "Unassigned" ? existing.owner : row.owner,
        notes: existing?.notes ? existing.notes : row.notes,
        activity
      });
    });
    state.renewals = [...byId.values()];
  }

  function renewalIsNtv(row) {
    const status = cleanString(row.status).toLowerCase();
    return status.includes("ntv") || status.includes("notice");
  }

  function getCommunityEmail(propertyName) {
    const record = getCommunityRecord(propertyName);
    return cleanString(record.communityEmail || record.propertyEmail || record.email || record.leasingEmail || record.managerEmail).toLowerCase();
  }

  function moveOutIdentityMatches(existing = {}, incoming = {}) {
    const residentMatch = incoming.residentId && existing.residentId && normalizeKey(incoming.residentId) === normalizeKey(existing.residentId);
    const leaseMatch = incoming.leaseId && existing.leaseId && normalizeKey(incoming.leaseId) === normalizeKey(existing.leaseId);
    const residentUnitMatch = normalizeKey(incoming.propertyName) === normalizeKey(existing.propertyName) &&
      normalizeKey(incoming.unit) === normalizeKey(existing.unit) &&
      normalizeKey(incoming.residentName) === normalizeKey(existing.residentName);
    return Boolean(residentMatch || leaseMatch || residentUnitMatch);
  }

  function activeMoveOutCases(state) {
    return state.moveOutCases.filter(caseRecord => !isCaseArchivedOrClosed(caseRecord));
  }

  function compareMoveOutIncoming(existing = {}, incoming = {}) {
    const fields = [
      ["Resident name", "residentName", "text"],
      ["Property", "propertyName", "text"],
      ["Unit", "unit", "text"],
      ["Scheduled move-out", "scheduledMoveOutDate", "date"],
      ["Notice date", "ntvReceivedDate", "date"],
      ["Lease expiration", "leaseExpiration", "date"],
      ["Move-in date", "moveInDate", "date"],
      ["Phone", "phone", "text"],
      ["Email", "email", "text"],
      ["Deposit", "depositHeld", "money"],
      ["Forwarding address", "forwardingAddress", "text"],
      ["Assigned regional", "assignedRegional", "text"],
      ["Assigned user", "owner", "text"]
    ];
    return fields.flatMap(([label, key, type]) => {
      const incomingRaw = incoming[key];
      const incomingComparable = type === "date" ? normalizeDate(incomingRaw) : type === "money" ? numberValue(incomingRaw) : cleanString(incomingRaw);
      const existingComparable = type === "date" ? normalizeDate(existing[key]) : type === "money" ? numberValue(existing[key]) : cleanString(existing[key]);
      if (incomingComparable === "" || incomingComparable === 0 || incomingComparable === existingComparable) return [];
      return [{
        label,
        field: key,
        existing: type === "date" ? formatDate(existingComparable) : type === "money" ? formatMoney(existingComparable) : existingComparable,
        incoming: type === "date" ? formatDate(incomingComparable) : type === "money" ? formatMoney(incomingComparable) : incomingComparable,
        incomingRaw: incomingComparable
      }];
    });
  }

  function findExistingMoveOutMatch(state, incoming) {
    return activeMoveOutCases(state).find(existing => moveOutIdentityMatches(existing, incoming)) || null;
  }

  function queuePotentialMoveOutUpdate(state, existing, incoming, conflicts) {
    const id = makeId("potential_moveout_update", [
      existing.id,
      incoming.sourceFileName || incoming.source,
      conflicts.map(conflict => `${conflict.field}:${conflict.incomingRaw}`).join("|")
    ]);
    const existingReview = state.potentialMoveOutUpdates.find(row => row.id === id);
    if (existingReview) return existingReview;
    const review = {
      id,
      status: "Review Required",
      existingMoveOutId: existing.id,
      source: incoming.source || "move_out_update",
      sourceLabel: incoming.sourceFileName || incoming.sourceLabel || "Potential Record Update",
      propertyName: existing.propertyName,
      unit: existing.unit,
      residentName: existing.residentName,
      conflicts,
      incoming,
      createdAt: new Date().toISOString(),
      createdBy: currentActor().name
    };
    state.potentialMoveOutUpdates.unshift(review);
    existing.potentialUpdates = asArray(existing.potentialUpdates);
    existing.potentialUpdates.unshift({ id, at: review.createdAt, label: "Potential Record Update queued for review.", conflicts: conflicts.map(conflict => conflict.label) });
    pushCaseActivity(existing, "Potential Record Update queued for authorized review.");
    addAudit(state, "Queued potential move-out record update", { existingMoveOutId: existing.id, fields: conflicts.map(conflict => conflict.field) });
    return review;
  }

  function createMoveOutLifecycleRecord(state, incoming) {
    const prepared = {
      ...incoming,
      residentName: cleanString(incoming.residentName),
      residentId: cleanString(incoming.residentId),
      leaseId: cleanString(incoming.leaseId),
      propertyName: cleanString(incoming.propertyName),
      unit: cleanString(incoming.unit),
      scheduledMoveOutDate: normalizeDate(incoming.scheduledMoveOutDate),
      leaseExpiration: normalizeDate(incoming.leaseExpiration),
      ntvReceivedDate: normalizeDate(incoming.ntvReceivedDate || incoming.noticeDate),
      noticeDate: normalizeDate(incoming.noticeDate || incoming.ntvReceivedDate),
      moveInDate: normalizeDate(incoming.moveInDate),
      phone: cleanString(incoming.phone),
      email: cleanString(incoming.email).toLowerCase(),
      forwardingAddress: cleanString(incoming.forwardingAddress),
      communityEmail: cleanString(incoming.communityEmail || getCommunityEmail(incoming.propertyName)).toLowerCase(),
      depositHeld: numberValue(incoming.depositHeld),
      owner: cleanString(incoming.owner || incoming.assignedCentralServicesUser || "Unassigned")
    };
    const existing = findExistingMoveOutMatch(state, prepared);
    if (existing) {
      const conflicts = compareMoveOutIncoming(existing, prepared);
      if (conflicts.length) {
        queuePotentialMoveOutUpdate(state, existing, prepared, conflicts);
      } else if (!prepared.suppressDuplicateAudit) {
        addAudit(state, "Ignored duplicate move-out lifecycle record", { existingMoveOutId: existing.id, residentName: existing.residentName });
      }
      return existing;
    }

    const id = cleanString(prepared.id) || makeId("moveout", [
      prepared.residentId,
      prepared.leaseId,
      prepared.propertyName,
      prepared.unit,
      prepared.scheduledMoveOutDate || prepared.leaseExpiration || prepared.residentName
    ]);
    const inspectionDate = calculateDefaultInspectionDate(state, prepared);
    const createdAt = new Date().toISOString();
    const initialStatus = prepared.scheduledMoveOutDate ? "Upcoming Move Out" : "On Notice";
    const caseRecord = normalizeMoveOutCaseRecord({
      id,
      renewalId: prepared.renewalId,
      source: prepared.source || "manual",
      sourceFileName: prepared.sourceFileName,
      renewalTrackerSource: prepared.renewalTrackerSource || prepared.sourceFileName,
      createdAt,
      periodKey: prepared.periodKey || localPeriodKey(selectedMonthIdx(state), selectedYear(state)),
      summaryPlaceholder: Boolean(prepared.summaryPlaceholder),
      propertyName: prepared.propertyName,
      residentName: prepared.residentName,
      residentId: prepared.residentId,
      leaseId: prepared.leaseId,
      unit: prepared.unit,
      unitType: prepared.unitType,
      moveInDate: prepared.moveInDate,
      phone: prepared.phone,
      email: prepared.email,
      leaseExpiration: prepared.leaseExpiration,
      scheduledMoveOutDate: prepared.scheduledMoveOutDate,
      actualPossessionReturnedDate: "",
      depositHeld: prepared.depositHeld,
      ntvReceivedDate: prepared.ntvReceivedDate || TODAY_ISO,
      noticeDate: prepared.noticeDate || prepared.ntvReceivedDate || TODAY_ISO,
      owner: prepared.owner,
      assignedRegional: prepared.assignedRegional,
      assignedCentralServicesUser: prepared.owner,
      communityEmail: prepared.communityEmail,
      workflowStatus: initialStatus,
      mogStatus: "Not Initiated",
      inspectionStatus: inspectionDate ? "Inspection Scheduled" : "Not Scheduled",
      inspectionDate,
      inspectionApprovalStatus: "Inspection Pending",
      morfSodaStatus: "Not Started",
      accountingStatus: "Not Sent",
      forwardingAddress: prepared.forwardingAddress,
      notes: prepared.notes || "",
      lifecycleTimestamps: {
        workflowCreated: createdAt,
        noticeReceived: createdAt,
        moveOutScheduled: prepared.scheduledMoveOutDate ? createdAt : "",
        inspectionScheduled: inspectionDate ? createdAt : ""
      },
      activity: [
        { at: createdAt, label: `Workflow created via ${prepared.source === "renewal_tracker" ? "Renewal Tracker" : "manual entry"}.` },
        { at: createdAt, label: "Notice received." },
        ...(prepared.scheduledMoveOutDate ? [{ at: createdAt, label: `Scheduled move-out set for ${prepared.scheduledMoveOutDate}.` }] : []),
        ...(inspectionDate ? [{ at: createdAt, label: `Move-out inspection scheduled for ${inspectionDate}.` }] : [])
      ]
    });
    state.moveOutCases.unshift(caseRecord);
    state.tasks.unshift({
      id: makeId("task", [id, "possession-confirmation"]),
      sourceCaseId: id,
      sourceRenewalId: prepared.renewalId,
      type: "Move-Out",
      propertyName: prepared.propertyName,
      residentName: prepared.residentName,
      title: `Confirm possession for ${prepared.residentName}`,
      owner: prepared.owner || "Unassigned",
      dueDate: inspectionDate || prepared.scheduledMoveOutDate || TODAY_ISO,
      status: "Open",
      priority: "High",
      createdAt
    });
    addAudit(state, "Created move-out lifecycle record", { residentName: prepared.residentName, propertyName: prepared.propertyName, source: prepared.source });
    return caseRecord;
  }

  function createMoveOutCaseFromRenewal(state, row) {
    if (!row || !renewalIsNtv(row)) return null;
    return createMoveOutLifecycleRecord(state, {
      renewalId: row.id,
      source: "renewal_tracker",
      sourceFileName: row.sourceFileName,
      renewalTrackerSource: row.sourceFileName,
      periodKey: row.periodKey,
      propertyName: row.propertyName,
      residentName: row.residentName,
      residentId: row.residentId,
      leaseId: row.leaseId,
      unit: row.unit,
      unitType: row.unitType,
      moveInDate: row.moveInDate,
      phone: row.phone,
      email: row.email,
      leaseExpiration: row.expirationDate,
      scheduledMoveOutDate: row.scheduledMoveOutDate,
      depositHeld: row.depositHeld,
      ntvReceivedDate: row.ntvReceivedDate,
      forwardingAddress: row.forwardingAddress,
      assignedRegional: row.assignedRegional,
      assignedCentralServicesUser: row.assignedCentralServicesUser,
      communityEmail: row.communityEmail,
      owner: row.owner || "Unassigned",
      notes: row.notes || "",
      suppressDuplicateAudit: Boolean(row.suppressDuplicateAudit)
    });
  }

  function createMoveOutCasesForNtvRows(state, rows) {
    rows.filter(renewalIsNtv).forEach(row => createMoveOutCaseFromRenewal(state, row));
  }

  function removeRenewalSummaryPlaceholders(state, propertyName, periodKey) {
    const removableIds = new Set();
    state.moveOutCases = state.moveOutCases.filter(caseRecord => {
      const samePeriod = cleanString(caseRecord.propertyName) === cleanString(propertyName) && cleanString(caseRecord.periodKey) === cleanString(periodKey);
      if (samePeriod && moveOutCaseIsUneditedSummaryPlaceholder(caseRecord)) {
        removableIds.add(caseRecord.id);
        return false;
      }
      return true;
    });
    if (removableIds.size) {
      state.tasks = state.tasks.filter(task => !removableIds.has(task.sourceCaseId));
      addAudit(state, "Cleared Renewal NTV intake placeholders after resident detail import", { propertyName, periodKey, count: removableIds.size });
    }
    return removableIds.size;
  }

  function removeMoveOutCasesById(state, ids = []) {
    const idSet = new Set(asArray(ids).map(cleanString).filter(Boolean));
    if (!idSet.size) return 0;
    const beforeCount = state.moveOutCases.length;
    state.moveOutCases = state.moveOutCases.filter(caseRecord => !idSet.has(caseRecord.id));
    state.tasks = state.tasks.filter(task => !idSet.has(task.sourceCaseId));
    return Math.max(0, beforeCount - state.moveOutCases.length);
  }

  function moveOutCaseIsUneditedSummaryPlaceholder(caseRecord = {}) {
    return caseRecord.source === "renewal_summary_ntv_intake" &&
      caseRecord.summaryPlaceholder === true &&
      normalizeKey(caseRecord.residentName).startsWith("resident pending") &&
      !getActualPossessionDate(caseRecord) &&
      !asArray(caseRecord.memos).length &&
      !asArray(caseRecord.communications).length;
  }

  function importRenewalRowsToCentralServices(state, rawRows, context = {}, options = {}) {
    const propertyName = cleanString(context.propertyName);
    if (!propertyName) return { rowsImported: 0, ntvCount: 0, moveOutCasesCreated: 0, potentialUpdatesQueued: 0, renewalRows: [] };
    const monthIdx = Math.max(0, Math.min(11, Number(context.monthIdx ?? selectedMonthIdx(state)) || 0));
    const year = Number.isFinite(Number(context.year)) ? Number(context.year) : selectedYear(state);
    const fileName = cleanString(context.fileName || context.sourceFileName || "Renewal Tracker upload");
    const sourceSheetName = cleanString(context.sourceSheetName || context.sheetName);
    const periodKey = localPeriodKey(monthIdx, year);
    const rows = mapRenewalRows(rawRows, { propertyName, monthIdx, year, fileName }, getCentralServicesEmployees());
    if (!rows.length) return { rowsImported: 0, ntvCount: 0, moveOutCasesCreated: 0, potentialUpdatesQueued: 0, renewalRows: [] };
    if (options.audit === false) rows.forEach(row => { row.suppressDuplicateAudit = true; });
    const ntvCount = rows.filter(renewalIsNtv).length;
    if (ntvCount) removeRenewalSummaryPlaceholders(state, propertyName, periodKey);
    const beforeCaseCount = state.moveOutCases.length;
    const beforeReviewCount = asArray(state.potentialMoveOutUpdates).length;
    upsertRenewals(state, rows);
    createMoveOutCasesForNtvRows(state, rows);
    if (context.syncAtlasSummary !== false) {
      syncRenewalSummaryToAtlas(propertyName, monthIdx, year, state);
    }
    if (options.importHistory !== false) {
      state.importHistory.unshift({
        id: makeId("import", [fileName, propertyName, periodKey, sourceSheetName || "sheet", Date.now()]),
        importedAt: new Date().toISOString(),
        fileName,
        sourceSheetName,
        propertyName,
        monthIdx,
        year,
        rowCount: rows.length,
        ntvCount,
        source: context.source || "Renewal Tracker upload"
      });
      state.importHistory = state.importHistory.slice(0, 50);
    }
    if (options.audit !== false) {
      addAudit(state, "Imported renewal rows into Central Services", { propertyName, periodKey, rows: rows.length, ntvCount, source: fileName });
    }
    return {
      rowsImported: rows.length,
      ntvCount,
      moveOutCasesCreated: Math.max(0, state.moveOutCases.length - beforeCaseCount),
      potentialUpdatesQueued: Math.max(0, asArray(state.potentialMoveOutUpdates).length - beforeReviewCount),
      renewalRows: rows.map(row => ({ ...row }))
    };
  }

  function getAtlasRenewalDetailRows(property = {}, monthIdx, year) {
    const periodKey = localPeriodKey(monthIdx, year);
    const periodRows = asArray(property.record?.renewalDetailRowsByPeriod?.[periodKey]);
    if (periodRows.length) return periodRows;
    return asArray(property.record?.renewalDetailRowsByMonth?.[monthIdx]).filter(row => {
      const rowYear = Number(row?.year);
      return !Number.isFinite(rowYear) || rowYear === Number(year);
    });
  }

  function countRenewalMoveOutCasesForPeriod(state, propertyName, periodKey) {
    return renewalMoveOutCasesForPeriod(state, propertyName, periodKey).length;
  }

  function renewalMoveOutCasesForPeriod(state, propertyName, periodKey) {
    return state.moveOutCases.filter(caseRecord => {
      if (isCaseArchivedOrClosed(caseRecord)) return false;
      if (cleanString(caseRecord.propertyName) !== cleanString(propertyName)) return false;
      if (cleanString(caseRecord.periodKey) !== cleanString(periodKey)) return false;
      return ["renewal_tracker", "renewal_import", "renewal_summary_ntv_intake"].includes(cleanString(caseRecord.source));
    });
  }

  function syncRenewalSummaryNtvIntake(state, propertyName, monthIdx, year, summary, sourceLabel = "") {
    const targetCount = whole(summary?.ntv);
    const periodKey = localPeriodKey(monthIdx, year);
    if (!targetCount) {
      const removed = removeMoveOutCasesById(state, renewalMoveOutCasesForPeriod(state, propertyName, periodKey)
        .filter(moveOutCaseIsUneditedSummaryPlaceholder)
        .map(caseRecord => caseRecord.id));
      return { created: 0, removed };
    }
    const existingCases = renewalMoveOutCasesForPeriod(state, propertyName, periodKey);
    const excessCount = Math.max(0, existingCases.length - targetCount);
    const removableIds = existingCases
      .filter(moveOutCaseIsUneditedSummaryPlaceholder)
      .sort((left, right) => cleanString(right.unit).localeCompare(cleanString(left.unit), undefined, { numeric: true }))
      .slice(0, excessCount)
      .map(caseRecord => caseRecord.id);
    const removed = removeMoveOutCasesById(state, removableIds);
    const existingCount = countRenewalMoveOutCasesForPeriod(state, propertyName, periodKey);
    const missingCount = Math.max(0, targetCount - existingCount);
    for (let index = existingCount + 1; index <= targetCount; index += 1) {
      createMoveOutLifecycleRecord(state, {
        id: makeId("moveout", [propertyName, periodKey, "renewal-summary-ntv", index]),
        source: "renewal_summary_ntv_intake",
        sourceFileName: sourceLabel || "ATLAS renewal summary",
        periodKey,
        propertyName,
        residentName: `Resident pending from ${MONTH_LABELS[monthIdx]} NTV upload #${index}`,
        unit: `Pending NTV ${index}`,
        leaseExpiration: "",
        scheduledMoveOutDate: "",
        ntvReceivedDate: TODAY_ISO,
        owner: "Unassigned",
        summaryPlaceholder: true,
        notes: "Created from saved Renewal Tracker NTV count because resident-level detail rows were not available. Update this intake record or re-import the resident-level tracker."
      });
    }
    if (missingCount) addAudit(state, "Created Renewal NTV intake placeholders", { propertyName, periodKey, count: missingCount });
    if (removed) addAudit(state, "Removed extra Renewal NTV intake placeholders", { propertyName, periodKey, count: removed });
    return { created: missingCount, removed };
  }

  function getAtlasRenewalImportSourceLabel(property = {}, periodKey = "") {
    try {
      if (typeof getPeriodImportStamp === "function") {
        return cleanString(getPeriodImportStamp(property.record, "renewals", periodKey)?.sourceFileName);
      }
    } catch {
      // Import tracking is optional and can lag behind local renewal data.
    }
    return "";
  }

  function syncAtlasRenewalDataIntoCentralServices(state) {
    let changed = false;
    const monthIdx = selectedMonthIdx(state);
    const year = selectedYear(state);
    const periodKey = localPeriodKey(monthIdx, year);
    getScopedProperties(state).forEach(property => {
      const detailRows = getAtlasRenewalDetailRows(property, monthIdx, year);
      if (detailRows.length) {
        const beforeState = JSON.stringify({
          renewals: state.renewals,
          moveOutCases: state.moveOutCases,
          tasks: state.tasks,
          potentialMoveOutUpdates: state.potentialMoveOutUpdates
        });
        importRenewalRowsToCentralServices(state, detailRows, {
          propertyName: property.name,
          monthIdx,
          year,
          fileName: getAtlasRenewalImportSourceLabel(property, periodKey) || "Saved Renewal Tracker rows",
          source: "Saved ATLAS renewal detail rows",
          syncAtlasSummary: false
        }, { importHistory: false, audit: false });
        const afterState = JSON.stringify({
          renewals: state.renewals,
          moveOutCases: state.moveOutCases,
          tasks: state.tasks,
          potentialMoveOutUpdates: state.potentialMoveOutUpdates
        });
        if (afterState !== beforeState) changed = true;
        return;
      }
      const entry = getRenewalEntry(property, monthIdx, year);
      const summary = renewalSummaryFromEntry(entry);
      const beforeCount = state.moveOutCases.length;
      syncRenewalSummaryNtvIntake(state, property.name, monthIdx, year, summary, getAtlasRenewalImportSourceLabel(property, periodKey) || "ATLAS renewal summary");
      if (state.moveOutCases.length !== beforeCount) changed = true;
    });
    return changed;
  }

  function syncRenewalSummaryToAtlas(propertyName, monthIdx, year, state) {
    const rows = state.renewals.filter(row => row.propertyName === propertyName && row.periodKey === localPeriodKey(monthIdx, year));
    if (!rows.length) return;
    const summary = summarizeRenewalRows(rows);
    try {
      if (typeof savedData === "undefined") return;
      const matched = typeof matchPropertyName === "function" ? matchPropertyName(propertyName, { fallbackToCurrent: false }) || propertyName : propertyName;
      const record = typeof normalizeSavedCommunityRecord === "function"
        ? normalizeSavedCommunityRecord(matched, savedData?.[matched] || {})
        : asObject(savedData?.[matched]);
      if (typeof applyRenewalSummaryToRecord === "function") {
        applyRenewalSummaryToRecord(record, monthIdx, {
          expirations: summary.expirations,
          renewalsSigned: summary.signed,
          ntv: summary.ntv,
          transfers: summary.transfers,
          undecided: summary.undecided,
          earlyTermination: summary.earlyTermination
        }, year);
      } else {
        record.monthlyData = Array.isArray(record.monthlyData) ? record.monthlyData : [];
        record.monthlyData[monthIdx] = {
          ...asObject(record.monthlyData[monthIdx]),
          renewalExpirations: summary.expirations,
          renewalSigned: summary.signed,
          renewalNTV: summary.ntv,
          renewalTransfers: summary.transfers,
          renewalUndecided: summary.undecided,
          renewalEarlyTermination: summary.earlyTermination
        };
      }
      try {
        if (typeof setRecordPeriodImportStamp === "function") {
          setRecordPeriodImportStamp(record, "renewals", localPeriodKey(monthIdx, year), {
            importedAt: new Date().toISOString(),
            sourceFileName: "Central Services detailed renewal import",
            propertyName
          });
        }
      } catch {
        // Import tracking is optional.
      }
      savedData[matched] = record;
      if (typeof persistSaved === "function") persistSaved();
      if (typeof renderPropGrid === "function") renderPropGrid();
    } catch (error) {
      console.warn("Central Services could not sync renewal summary to ATLAS", error);
    }
  }

  function findMoveOutCase(state, id) {
    return state.moveOutCases.find(item => item.id === id);
  }

  function pushCaseActivity(caseRecord, label, details = {}) {
    const actor = currentActor();
    caseRecord.activity = asArray(caseRecord.activity);
    caseRecord.activity.unshift({
      at: new Date().toISOString(),
      label,
      action: label,
      user: actor.name,
      userId: actor.userId,
      previousStatus: details.previousStatus || "",
      newStatus: details.newStatus || "",
      memo: details.memo || "",
      details
    });
    caseRecord.activity = caseRecord.activity.slice(0, 150);
  }

  function pushInspectionAudit(inspection, label, details = {}) {
    inspection.audit = asArray(inspection.audit);
    inspection.audit.unshift({ at: new Date().toISOString(), label, details });
    inspection.audit = inspection.audit.slice(0, 100);
  }

  function pushMorfAudit(morf, label, details = {}) {
    morf.audit = asArray(morf.audit);
    morf.audit.unshift({ at: new Date().toISOString(), label, details });
    morf.audit = morf.audit.slice(0, 150);
  }

  function pushDisputeAudit(dispute, label, details = {}) {
    dispute.audit = asArray(dispute.audit);
    dispute.audit.unshift({ at: new Date().toISOString(), label, details });
    dispute.audit = dispute.audit.slice(0, 100);
  }

  function findInspection(state, id) {
    return state.inspections.find(item => item.id === id);
  }

  function findMorf(state, id) {
    return state.morfRecords.find(item => item.id === id);
  }

  function findDispute(state, id) {
    return state.residentDisputes.find(item => item.id === id);
  }

  function getMoveOutTemplate(state) {
    return state.inspectionTemplates.find(template => template.name === "Move-Out Inspection") || state.inspectionTemplates[0] || defaultInspectionTemplates()[0];
  }

  function buildInspectionRecord(state, input = {}) {
    const template = getInspectionTemplateById(state, input.templateId || getMoveOutTemplate(state).id);
    const id = cleanString(input.id) || makeId("inspection", [
      template.id,
      input.propertyName,
      input.unit || input.locationName,
      Date.now()
    ]);
    const inspectionDate = normalizeDate(input.inspectionDate) || TODAY_ISO;
    return normalizeInspectionRecord({
      id,
      templateId: template.id,
      templateName: template.name,
      source: input.source || "central_services",
      relatedMoveOutId: cleanString(input.relatedMoveOutId),
      propertyName: cleanString(input.propertyName),
      locationType: cleanString(input.locationType || "Apartment"),
      building: cleanString(input.building),
      floor: cleanString(input.floor),
      unit: cleanString(input.unit),
      room: cleanString(input.room),
      commonAreaType: cleanString(input.commonAreaType),
      locationName: cleanString(input.locationName),
      residentName: cleanString(input.residentName),
      residentId: cleanString(input.residentId),
      leaseId: cleanString(input.leaseId),
      residentPresent: cleanString(input.residentPresent || "No"),
      possessionReturnedDate: normalizeDate(input.possessionReturnedDate),
      inspectionDate,
      inspectorName: cleanString(input.inspectorName || "Unassigned"),
      status: INSPECTION_STATUSES.includes(input.status) ? input.status : "Draft",
      syncStatus: INSPECTION_SYNC_STATUSES.includes(input.syncStatus) ? input.syncStatus : "Saved Offline",
      findings: [],
      signatures: [],
      audit: [{
        at: new Date().toISOString(),
        label: "Inspection created.",
        details: { templateName: template.name }
      }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }

  function createMoveOutInspection(state, caseRecord, employees = []) {
    const existing = state.inspections.find(inspection => inspection.relatedMoveOutId === caseRecord.id && inspection.templateName === "Move-Out Inspection");
    if (existing) return existing;
    const actualPossession = getActualPossessionDate(caseRecord);
    const defaultInspector = caseRecord.inspectorEmployeeId
      ? findInspectionEligibleEmployee(state, caseRecord.inspectorEmployeeId)
      : defaultInspectorForProperty(state, caseRecord.propertyName);
    const inspection = buildInspectionRecord(state, {
      templateId: getMoveOutTemplate(state).id,
      source: "move_out_case",
      relatedMoveOutId: caseRecord.id,
      propertyName: caseRecord.propertyName,
      locationType: "Apartment",
      unit: caseRecord.unit,
      residentName: caseRecord.residentName,
      residentId: caseRecord.residentId,
      leaseId: caseRecord.leaseId,
      residentPresent: "No",
      possessionReturnedDate: actualPossession,
      inspectionDate: caseRecord.inspectionDate || TODAY_ISO,
      inspectorName: caseRecord.inspectorName || defaultInspector?.name || defaultOwner(employees),
      inspectorEmployeeId: caseRecord.inspectorEmployeeId || defaultInspector?.employeeId || defaultInspector?.peopleEmployeeId || "",
      inspectorHomeProperty: caseRecord.inspectorHomeProperty || (defaultInspector ? employeeHomeProperty(defaultInspector) : ""),
      inspectionProperty: caseRecord.propertyName,
      status: actualPossession ? "Draft" : "HOLD - POSSESSION NOT RETURNED"
    });
    state.inspections.unshift(inspection);
    if (defaultInspector) applyInspectionAssignment(state, caseRecord, inspection, defaultInspector, "Default inspection assignment from People roster eligibility.");
    caseRecord.inspectionStatus = inspection.status;
    caseRecord.inspectionApprovalStatus = "Inspection Pending";
    if (actualPossession) {
      setCaseWorkflowStatus(caseRecord, "Move-Out Inspection", "Move-out field inspection created.");
    } else {
      setCaseWorkflowStatus(caseRecord, "Inspection Hold - Possession Not Returned", "Move-out inspection created in hold because possession has not been confirmed.");
    }
    addAudit(state, "Created move-out inspection", { caseId: caseRecord.id, inspectionId: inspection.id });
    return inspection;
  }

  function confirmPossessionForCase(state, caseRecord, date, employees = []) {
    const actualDate = normalizeDate(date);
    if (!caseRecord || !actualDate) return null;
    caseRecord.actualPossessionReturnedDate = actualDate;
    caseRecord.possessionReturnedDate = actualDate;
    caseRecord.possessionStatus = "Returned";
    caseRecord.inspectionDate = addBusinessDaysWithSettings(state, actualDate, 1);
    caseRecord.inspectionStatus = "Inspection Scheduled";
    caseRecord.inspectionApprovalStatus = caseInspectionIsApproved(state, caseRecord) ? "Approved" : "Inspection Pending";
    stampLifecycle(caseRecord, "actualPossessionConfirmed");
    stampLifecycle(caseRecord, "inspectionScheduled");
    setCaseWorkflowStatus(caseRecord, "Move-Out Inspection", `Actual possession returned on ${actualDate}; inspection released for processing.`, { actualPossessionReturnedDate: actualDate });
    const inspection = getMoveOutInspectionForCase(state, caseRecord);
    if (inspection) {
      inspection.status = inspection.status === "HOLD - POSSESSION NOT RETURNED" ? "Draft" : inspection.status;
      inspection.possessionReturnedDate = actualDate;
      inspection.inspectionDate = caseRecord.inspectionDate;
      inspection.updatedAt = new Date().toISOString();
      pushInspectionAudit(inspection, "Inspection released from possession hold.", { actualPossessionReturnedDate: actualDate });
    }
    const morf = ensureMorfForMoveOutCase(state, caseRecord, employees);
    if (morf) {
      morf.possessionReturnedDate = actualDate;
      morf.internalDueDate = calculateInternalMorfDueDate(state, caseRecord);
      morf.legalDeadline = calculateLegalDeadlineForCase(state, caseRecord);
      morf.status = caseInspectionIsApproved(state, caseRecord) ? "MORF Ready" : "Draft - Inspection Approval Required";
      morf.inspectionApprovalStatus = caseInspectionIsApproved(state, caseRecord) ? "Approved" : "Inspection Approval Required";
      pushMorfAudit(morf, "MORF draft refreshed after actual possession confirmation.", { actualPossessionReturnedDate: actualDate });
    }
    return morf;
  }

  function buildMorfChargeFromFinding(state, inspection, finding) {
    const catalogItem = getChargebackCatalogItem(state, finding.chargebackId);
    const calc = calculateCatalogCharge(state, catalogItem, inspection.propertyName);
    const photo = asArray(finding.photos)[0] || {};
    return {
      id: makeId("morfcharge", [inspection.id, finding.id, finding.chargebackId]),
      sourceInspectionId: inspection.id,
      sourceFindingId: finding.id,
      catalogItemId: finding.chargebackId,
      description: catalogItem?.item || finding.component || "Resident charge",
      category: catalogItem?.category || "Inspection",
      room: finding.room,
      damage: finding.component,
      thumbnail: photo.dataUrl || "",
      originalInspectorRecommendation: finding.notes || "",
      originalInspectorAmount: numberValue(finding.inspectorRecommendedAmount || calc.recommendedCharge),
      catalogRecommendation: calc,
      recommendedAmount: calc.recommendedCharge,
      finalAmount: calc.recommendedCharge,
      adjustmentReason: "",
      calculationSummary: formatChargeCalculation(state, catalogItem, inspection.propertyName),
      audit: [{
        at: new Date().toISOString(),
        label: "Charge created from approved inspection finding.",
        details: { inspectionId: inspection.id, findingId: finding.id }
      }]
    };
  }

  function syncMorfChargesFromCase(state, morf, caseRecord) {
    const existing = new Map(asArray(morf.charges).map(charge => [charge.id, charge]));
    getApprovedInspectionChargesForCase(state, caseRecord).forEach(({ inspection, finding }) => {
      const built = buildMorfChargeFromFinding(state, inspection, finding);
      const prior = existing.get(built.id);
      existing.set(built.id, prior ? { ...built, ...prior, catalogRecommendation: built.catalogRecommendation, calculationSummary: built.calculationSummary } : built);
    });
    morf.charges = [...existing.values()];
    morf.inspectionApprovalStatus = caseRecord.inspectionApprovalStatus || caseRecord.inspectionStatus || "Inspection Pending";
  }

  function ensureMorfForMoveOutCase(state, caseRecord, employees = []) {
    if (!caseRecord) return null;
    const id = makeId("morf", [caseRecord.id, caseRecord.propertyName, caseRecord.unit]);
    let morf = state.morfRecords.find(item => item.id === id);
    const internalDueDate = calculateInternalMorfDueDate(state, caseRecord);
    const legalDeadline = calculateLegalDeadlineForCase(state, caseRecord);
    const actualPossession = getActualPossessionDate(caseRecord);
    const inspection = getMoveOutInspectionForCase(state, caseRecord);
    const inspectionApproved = caseInspectionIsApproved(state, caseRecord);
    if (!morf) {
      morf = normalizeMorfRecord({
        id,
        moveOutCaseId: caseRecord.id,
        renewalId: caseRecord.renewalId,
        source: "move_out_case",
        createdAt: new Date().toISOString(),
        lifecycleTimestamps: {
          morfCreated: new Date().toISOString()
        },
        propertyName: caseRecord.propertyName,
        propertyState: getPropertyStateCode(caseRecord.propertyName),
        unit: caseRecord.unit,
        residentName: caseRecord.residentName,
        residentId: caseRecord.residentId,
        leaseId: caseRecord.leaseId,
        additionalLeaseholders: "",
        moveInDate: caseRecord.moveInDate || "",
        moveOutDate: caseRecord.scheduledMoveOutDate,
        scheduledMoveOutDate: caseRecord.scheduledMoveOutDate,
        possessionReturnedDate: actualPossession,
        phone: caseRecord.phone,
        email: caseRecord.email,
        forwardingAddress: caseRecord.forwardingAddress,
        forwardingAddresses: caseRecord.forwardingAddress ? [{ id: makeId("addr", [id, caseRecord.forwardingAddress]), type: "Primary", address: caseRecord.forwardingAddress }] : [],
        inspectionId: inspection?.id || "",
        internalDueDate,
        legalDeadline,
        processor: caseRecord.owner || defaultOwner(employees),
        status: inspectionApproved ? "MORF Ready" : "Draft - Inspection Approval Required",
        inspectionApprovalStatus: inspectionApproved ? "Approved" : "Inspection Approval Required",
        accountingHandoffStatus: "Not Sent",
        deposits: caseRecord.depositHeld ? [{ id: makeId("line", [id, "security-deposit"]), description: "Security deposit", amount: numberValue(caseRecord.depositHeld), source: "Renewal import / move-out record" }] : [],
        credits: [],
        finalUtilities: [],
        finalRent: [],
        recurringCharges: [],
        pastDueCharges: [],
        charges: [],
        packetSelections: [],
        statementVersions: [],
        chargesReviewed: false,
        depositVerified: false,
        utilitiesReviewed: false,
        ledgerReviewed: false,
        calculationConfirmed: false,
        disputeStatus: "",
        delivery: { emailAddress: caseRecord.email || "" },
        audit: [{ at: new Date().toISOString(), label: "MORF draft created from move-out lifecycle record.", details: { caseId: caseRecord.id, inspectionApprovalRequired: !inspectionApproved } }]
      });
      state.morfRecords.unshift(morf);
      state.tasks.unshift({
        id: makeId("task", [id, "morf-due"]),
        sourceCaseId: caseRecord.id,
        sourceMorfId: id,
        type: "MORF",
        propertyName: caseRecord.propertyName,
        residentName: caseRecord.residentName,
        title: inspectionApproved ? `Process MORF for ${caseRecord.residentName}` : `Prepare MORF draft for ${caseRecord.residentName}`,
        owner: morf.processor || "Unassigned",
        dueDate: internalDueDate || TODAY_ISO,
        status: "Open",
        priority: "High",
        createdAt: new Date().toISOString()
      });
      addAudit(state, "Created MORF task", { caseId: caseRecord.id, morfId: id });
    } else {
      morf.internalDueDate = internalDueDate || morf.internalDueDate;
      morf.legalDeadline = legalDeadline || morf.legalDeadline;
      morf.possessionReturnedDate = actualPossession || morf.possessionReturnedDate;
      morf.forwardingAddress = caseRecord.forwardingAddress || morf.forwardingAddress;
      morf.inspectionId = inspection?.id || morf.inspectionId || "";
      morf.inspectionApprovalStatus = inspectionApproved ? "Approved" : caseRecord.inspectionApprovalStatus || morf.inspectionApprovalStatus;
      if (inspectionApproved && ["Inspection Pending", "Inspection Review Pending", "Draft - Inspection Approval Required", "Inspection Approval Required"].includes(morf.status)) {
        morf.status = "MORF Ready";
        morf.lifecycleTimestamps = asObject(morf.lifecycleTimestamps);
        morf.lifecycleTimestamps.morfReady = morf.lifecycleTimestamps.morfReady || new Date().toISOString();
      }
    }
    syncMorfChargesFromCase(state, morf, caseRecord);
    caseRecord.morfSodaStatus = morf.status;
    return morf;
  }

  function getAccountingContactForCase(state, caseRecord) {
    return state.accountingContacts.find(contact => contact.propertyName === caseRecord.propertyName) || state.accountingContacts.find(contact => contact.propertyName === "all");
  }

  function downloadJson(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  window.renderCentralServicesTab = renderCentralServices;

  window.atlasCsIngestRenewalSheetRows = function (sheetRows, context = {}, options = {}) {
    const state = loadState();
    const beforeCaseCount = state.moveOutCases.length;
    const beforeReviewCount = asArray(state.potentialMoveOutUpdates).length;
    const result = importRenewalRowsToCentralServices(state, sheetRows, context, {
      importHistory: options.importHistory !== false
    });
    const shouldSetUi = options.setUi === true;
    if (shouldSetUi && context.propertyName) {
      state.ui.module = "renewals";
      state.ui.propertyId = cleanString(context.propertyName);
      state.ui.monthIdx = Math.max(0, Math.min(11, Number(context.monthIdx ?? selectedMonthIdx(state)) || 0));
      state.ui.year = Number.isFinite(Number(context.year)) ? Number(context.year) : selectedYear(state);
    }
    saveState(state);
    if (options.render !== false) renderActiveTab();
    return {
      ...result,
      totalMoveOutCases: state.moveOutCases.length,
      totalPotentialUpdates: asArray(state.potentialMoveOutUpdates).length,
      totalMoveOutCaseDelta: Math.max(0, state.moveOutCases.length - beforeCaseCount),
      totalPotentialUpdateDelta: Math.max(0, asArray(state.potentialMoveOutUpdates).length - beforeReviewCount)
    };
  };

  window.atlasCsSyncRenewalSummaryNtvIntake = function (context = {}, summary = {}, options = {}) {
    const propertyName = cleanString(context.propertyName);
    if (!propertyName) return { created: 0, removed: 0, totalMoveOutCases: 0 };
    const state = loadState();
    const monthIdx = Math.max(0, Math.min(11, Number(context.monthIdx ?? selectedMonthIdx(state)) || 0));
    const year = Number.isFinite(Number(context.year)) ? Number(context.year) : selectedYear(state);
    const result = syncRenewalSummaryNtvIntake(state, propertyName, monthIdx, year, summary, context.sourceFileName || context.fileName || "ATLAS renewal summary");
    saveState(state);
    if (options.render !== false) renderActiveTab();
    return {
      ...result,
      totalMoveOutCases: state.moveOutCases.length
    };
  };

  window.atlasCsSetModule = function (module) {
    const state = loadState();
    state.ui.module = MODULES.some(([key]) => key === module) ? module : "overview";
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsSetProperty = function (propertyName) {
    const state = loadState();
    state.ui.propertyId = cleanString(propertyName) || "all";
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsSetMonth = function (value) {
    const state = loadState();
    state.ui.monthIdx = Math.max(0, Math.min(11, Number(value) || 0));
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsSetYear = function (value) {
    const state = loadState();
    state.ui.year = Number.isFinite(Number(value)) ? Number(value) : new Date().getFullYear();
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsSetSearch = function (value) {
    const state = loadState();
    state.ui.search = cleanString(value);
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsDrill = function (module, filter) {
    const state = loadState();
    state.ui.module = MODULES.some(([key]) => key === module) ? module : "overview";
    state.ui.workflowFilter = cleanString(filter) || "all";
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsScrollToDashboardPreferences = function () {
    try {
      document.getElementById("atlas-cs-dashboard-preferences")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch {
      // Keep the navigation usable even when smooth scrolling is unavailable.
    }
  };

  function updateCentralDashboardPreferences(state, mutator) {
    const current = getCentralDashboardPreferences(state);
    const next = typeof mutator === "function" ? mutator(cloneJson(current)) : { ...current, ...asObject(mutator) };
    next.updatedAt = new Date().toISOString();
    return setCentralDashboardPreferences(state, next);
  }

  window.atlasCsOpenDashboardRecord = function (recordType, id, module, filter) {
    const state = loadState();
    const type = cleanString(recordType);
    const recordId = cleanString(id);
    state.ui.module = MODULES.some(([key]) => key === module) ? module : "overview";
    state.ui.workflowFilter = cleanString(filter) || "all";
    if (type === "moveOut") {
      state.ui.module = "moveOuts";
      state.ui.selectedMoveOutId = recordId;
    } else if (type === "inspection") {
      state.ui.module = "inspections";
      state.ui.selectedInspectionId = recordId;
    } else if (type === "morf") {
      state.ui.module = module === "archive" ? "archive" : "morfs";
      state.ui.selectedMorfId = recordId;
    } else if (type === "task" || type === "po") {
      state.ui.module = "tasks";
      state.ui.selectedTaskId = recordId;
    } else if (type === "vendor" || type === "vendorInfraction") {
      state.ui.module = "vendors";
      state.ui.selectedVendorId = recordId;
    } else if (type === "dispute") {
      state.ui.module = "disputes";
      state.ui.selectedDisputeId = recordId;
    } else if (type === "invoice") {
      state.ui.module = "invoices";
    } else if (type === "bucket") {
      state.ui.workflowFilter = recordId || state.ui.workflowFilter;
    }
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsDashboardAddWidget = function (widgetKey) {
    const state = loadState();
    const definition = getCentralDashboardWidgetDefinition(widgetKey);
    if (!centralDashboardWidgetIsAvailable(definition)) return;
    updateCentralDashboardPreferences(state, prefs => ({
      ...prefs,
      widgets: [...prefs.widgets, buildCentralDashboardWidgetInstance(definition.key, prefs.widgets.length, {
        instanceId: `cs_widget_${definition.key}_${simpleHash(`${Date.now()}_${prefs.widgets.length}`)}`,
        position: prefs.widgets.length,
        size: definition.defaultSize || "standard"
      })],
      libraryOpen: true
    }));
    state.ui.dashboardConfigId = state.dashboardPreferencesByUser[centralDashboardUserKey()].widgets.slice(-1)[0]?.instanceId || "";
    addAudit(state, "Added Central Services dashboard widget", { widgetKey });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsDashboardRemoveWidget = function (instanceId) {
    const state = loadState();
    const target = cleanString(instanceId);
    updateCentralDashboardPreferences(state, prefs => ({
      ...prefs,
      widgets: prefs.widgets.filter(widget => widget.instanceId !== target).map((widget, index) => ({ ...widget, position: index }))
    }));
    if (state.ui.dashboardConfigId === target) state.ui.dashboardConfigId = "";
    addAudit(state, "Removed Central Services dashboard widget", { instanceId: target });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsDashboardMoveWidget = function (instanceId, direction) {
    const state = loadState();
    const target = cleanString(instanceId);
    const delta = Number(direction) || 0;
    if (!target || !delta) return;
    updateCentralDashboardPreferences(state, prefs => {
      const widgets = asArray(prefs.widgets).slice().sort((left, right) => (Number(left.position) || 0) - (Number(right.position) || 0));
      const index = widgets.findIndex(widget => widget.instanceId === target);
      const nextIndex = Math.max(0, Math.min(widgets.length - 1, index + delta));
      if (index < 0 || index === nextIndex) return prefs;
      const [moved] = widgets.splice(index, 1);
      widgets.splice(nextIndex, 0, moved);
      return { ...prefs, widgets: widgets.map((widget, widgetIndex) => ({ ...widget, position: widgetIndex })) };
    });
    addAudit(state, "Reordered Central Services dashboard widget", { instanceId: target, direction: delta });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsDashboardDragStart = function (event, instanceId) {
    centralDashboardDraggedInstanceId = cleanString(instanceId);
    try {
      event.dataTransfer?.setData("text/plain", centralDashboardDraggedInstanceId);
    } catch {
      // Drag still works through the module-level fallback.
    }
  };

  window.atlasCsDashboardDragOver = function (event) {
    if (event?.preventDefault) event.preventDefault();
  };

  window.atlasCsDashboardDrop = function (event, targetInstanceId) {
    if (event?.preventDefault) event.preventDefault();
    const source = cleanString(event?.dataTransfer?.getData("text/plain") || centralDashboardDraggedInstanceId);
    const target = cleanString(targetInstanceId);
    if (!source || !target || source === target) return;
    const state = loadState();
    updateCentralDashboardPreferences(state, prefs => {
      const widgets = asArray(prefs.widgets).slice().sort((left, right) => (Number(left.position) || 0) - (Number(right.position) || 0));
      const sourceIndex = widgets.findIndex(widget => widget.instanceId === source);
      const targetIndex = widgets.findIndex(widget => widget.instanceId === target);
      if (sourceIndex < 0 || targetIndex < 0) return prefs;
      const [moved] = widgets.splice(sourceIndex, 1);
      widgets.splice(targetIndex, 0, moved);
      return { ...prefs, widgets: widgets.map((widget, index) => ({ ...widget, position: index })) };
    });
    centralDashboardDraggedInstanceId = "";
    addAudit(state, "Drag-reordered Central Services dashboard widget", { source, target });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsDashboardSetWidgetSize = function (instanceId, size) {
    window.atlasCsDashboardUpdateWidget(instanceId, "size", size);
  };

  window.atlasCsDashboardToggleWidget = function (instanceId, field) {
    const state = loadState();
    const target = cleanString(instanceId);
    if (!["collapsed", "pinned"].includes(field)) return;
    updateCentralDashboardPreferences(state, prefs => ({
      ...prefs,
      widgets: prefs.widgets.map(widget => widget.instanceId === target ? { ...widget, [field]: !widget[field] } : widget)
    }));
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsDashboardEditWidget = function (instanceId) {
    const state = loadState();
    const target = cleanString(instanceId);
    state.ui.dashboardConfigId = state.ui.dashboardConfigId === target ? "" : target;
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsDashboardUpdateWidget = function (instanceId, field, value) {
    const state = loadState();
    const target = cleanString(instanceId);
    updateCentralDashboardPreferences(state, prefs => ({
      ...prefs,
      widgets: prefs.widgets.map(widget => {
        if (widget.instanceId !== target) return widget;
        const definition = getCentralDashboardWidgetDefinition(widget.widgetKey) || {};
        const next = { ...widget };
        if (field === "size") next.size = normalizeCentralDashboardSize(value);
        if (field === "visualization") next.visualization = normalizeCentralDashboardVisualization(value, definition);
        if (field === "dateRange" && CENTRAL_DASHBOARD_DATE_RANGES.includes(value)) next.dateRange = value;
        if (field === "propertyScope" && CENTRAL_DASHBOARD_SCOPE_OPTIONS.some(([key]) => key === value)) next.propertyScope = value;
        if (field === "propertyName") next.propertyName = cleanString(value);
        if (field === "portfolioScope" && CENTRAL_DASHBOARD_PORTFOLIO_SCOPE_OPTIONS.some(([key]) => key === value)) next.portfolioScope = value;
        if (field === "workflowFilter") next.workflowFilter = cleanString(value);
        if (field === "agingFilter" && CENTRAL_DASHBOARD_AGING_FILTERS.includes(value)) next.agingFilter = value;
        if (field === "sortOrder" && CENTRAL_DASHBOARD_SORT_OPTIONS.includes(value)) next.sortOrder = value;
        next.updatedAt = new Date().toISOString();
        return normalizeCentralDashboardWidgetInstance(next, next.position) || widget;
      })
    }));
    addAudit(state, "Updated Central Services dashboard widget", { instanceId: target, field, value });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsDashboardToggleLibrary = function () {
    const state = loadState();
    updateCentralDashboardPreferences(state, prefs => ({ ...prefs, libraryOpen: !prefs.libraryOpen }));
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsDashboardSaveView = function () {
    const state = loadState();
    updateCentralDashboardPreferences(state, prefs => ({ ...prefs, savedAt: new Date().toISOString() }));
    addAudit(state, "Saved personal Central Services dashboard view", { userKey: centralDashboardUserKey() });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsDashboardRestoreDefault = function () {
    if (!confirm("Restore your Central Services dashboard to the default command-center layout?")) return;
    const state = loadState();
    const userKey = centralDashboardUserKey();
    setCentralDashboardPreferences(state, {
      ...buildCentralDashboardDefaultPreferences(userKey),
      restoredAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    state.ui.dashboardConfigId = "";
    addAudit(state, "Restored personal Central Services default dashboard", { userKey });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsDashboardQuickAction = function (recordType, id, action) {
    const state = loadState();
    const type = cleanString(recordType);
    const recordId = cleanString(id);
    const actor = currentActor();
    if (action === "nudge") {
      const target = state.purchaseOrders.find(po => cleanString(po.id || po.poNumber) === recordId) || state.tasks.find(task => task.id === recordId);
      if (!target) return;
      target.lastNudgedAt = new Date().toISOString();
      target.nudgedBy = actor.name;
      state.notifications.unshift({
        id: makeId("notice", [recordId, "regional_nudge", Date.now()]),
        type: "Regional Approval Nudge",
        status: "Draft",
        createdAt: new Date().toISOString(),
        createdBy: actor.name,
        propertyName: dashboardPropertyNameForRecord(target),
        recipient: target.assignedRegional || target.regionalManager || target.regional || "Regional Manager",
        body: `Please review pending PO ${target.poNumber || target.purchaseOrderNumber || target.id || recordId}.`
      });
      addAudit(state, "Created Regional approval nudge", { recordType: type, id: recordId });
    } else if (type === "invoice") {
      const invoice = state.invoices.find(row => cleanString(row.id || row.invoiceNumber) === recordId);
      if (!invoice) return;
      if (action === "confirm") invoice.status = "Work Confirmed";
      if (action === "request_info") invoice.status = "Information Requested";
      if (action === "reject") invoice.status = "Rejected / Returned";
      if (action === "infraction") {
        invoice.status = "Vendor Infraction Reported";
        state.vendorInfractions.unshift({
          id: makeId("vendor_infraction", [recordId, Date.now()]),
          vendorName: invoice.vendorName || invoice.vendor,
          entrataVendorCode: invoice.entrataVendorCode || invoice.vendorCode,
          propertyName: dashboardPropertyNameForRecord(invoice),
          category: "Invoice Quality Review",
          severity: "Needs Review",
          workOrderNumber: invoice.workOrderNumber || invoice.workOrder,
          poNumber: invoice.poNumber || invoice.purchaseOrderNumber,
          invoiceNumber: invoice.invoiceNumber || recordId,
          openedAt: new Date().toISOString(),
          status: "Open",
          createdBy: actor.name
        });
      }
      invoice.reviewedAt = new Date().toISOString();
      invoice.reviewedBy = actor.name;
      addAudit(state, "Updated invoice dashboard action", { id: recordId, action, status: invoice.status });
    }
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsOpenPropertyRenewals = function (propertyName) {
    const state = loadState();
    state.ui.propertyId = cleanString(propertyName) || "all";
    state.ui.module = "renewals";
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsSelectRenewal = function (id) {
    const state = loadState();
    state.ui.selectedRenewalId = cleanString(id);
    state.ui.module = "renewals";
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsUpdateRenewalField = function (id, field, value) {
    const state = loadState();
    const allowed = new Set(["owner", "nextAction", "dueDate", "notes"]);
    if (!allowed.has(field)) return;
    const row = state.renewals.find(item => item.id === id);
    if (!row) return;
    row[field] = field === "dueDate" ? normalizeDate(value) : cleanString(value);
    row.activity = asArray(row.activity);
    row.activity.unshift({ at: new Date().toISOString(), label: `Updated ${field}.` });
    addAudit(state, "Updated renewal field", { id, field });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsUpdateRenewalStatus = function (id, status) {
    const state = loadState();
    const row = state.renewals.find(item => item.id === id);
    if (!row) return;
    row.status = cleanString(status) || "Pending Decision";
    row.activity = asArray(row.activity);
    row.activity.unshift({ at: new Date().toISOString(), label: `Status changed to ${row.status}.` });
    if (renewalIsNtv(row)) createMoveOutCaseFromRenewal(state, row);
    syncRenewalSummaryToAtlas(row.propertyName, row.monthIdx, row.year, state);
    addAudit(state, "Updated renewal status", { id, status: row.status });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsCreateMoveOutFromRenewal = function (id) {
    const state = loadState();
    const row = state.renewals.find(item => item.id === id);
    if (!row) return;
    if (!renewalIsNtv(row)) {
      alert("Set the renewal status to NTV Received before creating a move-out case.");
      return;
    }
    const caseRecord = createMoveOutCaseFromRenewal(state, row);
    state.ui.module = "moveOuts";
    state.ui.selectedMoveOutId = caseRecord?.id || "";
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsCreateManualMoveOut = function () {
    const state = loadState();
    const beforeReviewCount = asArray(state.potentialMoveOutUpdates).length;
    const propertyName = getImportControlValue("atlas-cs-manual-property");
    const residentName = getImportControlValue("atlas-cs-manual-resident");
    const unit = getImportControlValue("atlas-cs-manual-unit");
    if (!propertyName || propertyName === "all" || !residentName || !unit) {
      alert("Choose a property and enter the resident and unit before creating the lifecycle record.");
      return;
    }
    const caseRecord = createMoveOutLifecycleRecord(state, {
      source: "manual",
      sourceLabel: "Manual Move-Out Workflow Creation",
      propertyName,
      residentName,
      unit,
      residentId: getImportControlValue("atlas-cs-manual-resident-id"),
      leaseId: getImportControlValue("atlas-cs-manual-lease-id"),
      moveInDate: getImportControlValue("atlas-cs-manual-move-in"),
      leaseExpiration: getImportControlValue("atlas-cs-manual-expiration"),
      ntvReceivedDate: getImportControlValue("atlas-cs-manual-notice"),
      scheduledMoveOutDate: getImportControlValue("atlas-cs-manual-scheduled"),
      phone: getImportControlValue("atlas-cs-manual-phone"),
      email: getImportControlValue("atlas-cs-manual-email"),
      depositHeld: getImportControlValue("atlas-cs-manual-deposit"),
      forwardingAddress: getImportControlValue("atlas-cs-manual-forwarding"),
      assignedRegional: getImportControlValue("atlas-cs-manual-regional"),
      owner: getImportControlValue("atlas-cs-manual-owner"),
      notes: getImportControlValue("atlas-cs-manual-notes")
    });
    state.ui.module = "moveOuts";
    state.ui.workflowFilter = "all";
    state.ui.selectedMoveOutId = caseRecord?.id || "";
    addAudit(state, "Manual move-out workflow submitted", { caseId: caseRecord?.id, residentName, propertyName });
    saveState(state);
    renderActiveTab();
    if (asArray(state.potentialMoveOutUpdates).length > beforeReviewCount) {
      alert("Potential Record Update queued. Existing workflow data was not overwritten.");
    }
  };

  window.atlasCsOpenPotentialMoveOutUpdate = function (id) {
    const state = loadState();
    const review = state.potentialMoveOutUpdates.find(row => row.id === id);
    if (!review) return;
    state.ui.module = "moveOuts";
    state.ui.workflowFilter = "all";
    state.ui.selectedMoveOutId = review.existingMoveOutId;
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsApplyPotentialMoveOutUpdate = function (id) {
    const state = loadState();
    const review = state.potentialMoveOutUpdates.find(row => row.id === id);
    const caseRecord = review ? findMoveOutCase(state, review.existingMoveOutId) : null;
    if (!review || !caseRecord) return;
    if (!confirm("Apply the reviewed incoming fields to this lifecycle record? Workflow status, inspection data, MORF information, approvals, memos, and audit history will not be overwritten.")) return;
    asArray(review.conflicts).forEach(conflict => {
      const field = cleanString(conflict.field);
      if (!["residentName", "propertyName", "unit", "scheduledMoveOutDate", "ntvReceivedDate", "leaseExpiration", "moveInDate", "phone", "email", "depositHeld", "forwardingAddress", "assignedRegional", "owner"].includes(field)) return;
      if (["scheduledMoveOutDate", "ntvReceivedDate", "leaseExpiration", "moveInDate"].includes(field)) caseRecord[field] = normalizeDate(conflict.incomingRaw);
      else if (field === "depositHeld") caseRecord[field] = numberValue(conflict.incomingRaw);
      else caseRecord[field] = cleanString(conflict.incomingRaw);
    });
    review.status = "Applied";
    review.reviewedAt = new Date().toISOString();
    review.reviewedBy = currentActor().name;
    pushCaseActivity(caseRecord, "Potential Record Update reviewed and applied.", { fields: asArray(review.conflicts).map(conflict => conflict.field) });
    addAudit(state, "Applied potential move-out update", { reviewId: id, caseId: caseRecord.id });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsDismissPotentialMoveOutUpdate = function (id) {
    const state = loadState();
    const review = state.potentialMoveOutUpdates.find(row => row.id === id);
    if (!review) return;
    const reason = cleanString(prompt("Reason for dismissing this potential update.")) || "No change needed";
    review.status = "Dismissed";
    review.reviewedAt = new Date().toISOString();
    review.reviewedBy = currentActor().name;
    review.reviewReason = reason;
    const caseRecord = findMoveOutCase(state, review.existingMoveOutId);
    if (caseRecord) pushCaseActivity(caseRecord, "Potential Record Update dismissed.", { memo: reason });
    addAudit(state, "Dismissed potential move-out update", { reviewId: id, reason });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsSetInspectionStartProperty = function (propertyName) {
    const state = loadState();
    state.ui.inspectionStartProperty = cleanString(propertyName);
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsSetInspectorSearch = function (value) {
    const state = loadState();
    state.ui.inspectorSearch = cleanString(value);
    saveState(state);
    const select = document.getElementById("atlas-cs-inspection-inspector");
    if (select) {
      const propertyName = getImportControlValue("atlas-cs-inspection-property") || state.ui.inspectionStartProperty || state.ui.propertyId;
      select.innerHTML = inspectionEmployeeOptionsHtml(state, select.value, propertyName, state.ui.inspectorSearch);
      return;
    }
    renderActiveTab();
  };

  window.atlasCsFocusInspectorSearch = function () {
    try {
      document.getElementById("atlas-cs-inspection-inspector-search")?.focus();
    } catch {
      // Focus is a progressive enhancement for the browser UI.
    }
  };

  window.atlasCsStartInspectionFromControls = function () {
    const state = loadState();
    const templateId = getImportControlValue("atlas-cs-inspection-template");
    const propertyName = getImportControlValue("atlas-cs-inspection-property");
    if (!propertyName || propertyName === "all") {
      alert("Choose the ATLAS property before starting an inspection.");
      return;
    }
    const locationType = getImportControlValue("atlas-cs-inspection-location-type") || "Apartment";
    const locationValue = getImportControlValue("atlas-cs-inspection-location");
    const selectedInspectorValue = getImportControlValue("atlas-cs-inspection-inspector");
    const selectedInspector = findInspectionEligibleEmployee(state, selectedInspectorValue);
    const inspection = buildInspectionRecord(state, {
      templateId,
      propertyName,
      locationType,
      building: getImportControlValue("atlas-cs-inspection-building"),
      floor: getImportControlValue("atlas-cs-inspection-floor"),
      unit: locationType === "Apartment" ? locationValue : "",
      commonAreaType: locationType === "Common Area" ? locationValue : "",
      locationName: locationValue,
      residentPresent: getImportControlValue("atlas-cs-inspection-resident-present") || "No",
      inspectorName: selectedInspector?.name || selectedInspectorValue,
      inspectorEmployeeId: selectedInspector?.employeeId || selectedInspector?.peopleEmployeeId || "",
      inspectorHomeProperty: selectedInspector ? employeeHomeProperty(selectedInspector) : "",
      inspectionProperty: propertyName,
      inspectionDate: TODAY_ISO
    });
    state.inspections.unshift(inspection);
    if (selectedInspector) applyInspectionAssignment(state, null, inspection, selectedInspector, "Manual inspection start assignment.");
    state.ui.selectedInspectionId = inspection.id;
    state.ui.module = "inspections";
    addAudit(state, "Started inspection", { inspectionId: inspection.id, propertyName });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsAddInspectionTemplate = function () {
    const state = loadState();
    const name = getImportControlValue("atlas-cs-template-name");
    if (!name) {
      alert("Enter a template name.");
      return;
    }
    const template = normalizeInspectionTemplate(makeInspectionTemplate(name, {
      category: getImportControlValue("atlas-cs-template-category") || "Custom",
      requiredPhotos: getImportControlValue("atlas-cs-template-photos") !== "No",
      chargebackAvailability: getImportControlValue("atlas-cs-template-chargebacks") === "Yes",
      approvalRequired: getImportControlValue("atlas-cs-template-approval") !== "No",
      sections: uniqueStrings(getImportControlValue("atlas-cs-template-sections").split(","))
    }));
    state.inspectionTemplates = mergeConfigById(state.inspectionTemplates, [template], normalizeInspectionTemplate);
    addAudit(state, "Added inspection template", { template: template.name });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsSelectInspection = function (id) {
    const state = loadState();
    state.ui.selectedInspectionId = cleanString(id);
    state.ui.module = "inspections";
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsUpdateInspectionStatus = function (id, status) {
    const state = loadState();
    const inspection = findInspection(state, id);
    if (!inspection || !INSPECTION_STATUSES.includes(status)) return;
    inspection.status = status;
    inspection.updatedAt = new Date().toISOString();
    pushInspectionAudit(inspection, `Inspection status changed to ${status}.`);
    const caseRecord = getInspectionRelatedCase(state, inspection);
    if (caseRecord) {
      caseRecord.inspectionStatus = status;
      caseRecord.inspectionApprovalStatus = status;
      if (status === "Awaiting Review" || status === "Submitted" || status === "Under Review" || status === "Changes Requested") {
        setCaseWorkflowStatus(caseRecord, "Inspection Approval", `Inspection status changed to ${status}.`);
      } else if (isInspectionApprovedStatus(status)) {
        caseRecord.inspectionApprovedAt = new Date().toISOString();
        setCaseWorkflowStatus(caseRecord, getActualPossessionDate(caseRecord) ? "MORF Ready" : "Inspection Approval", `Inspection status changed to ${status}.`);
        if (getActualPossessionDate(caseRecord)) ensureMorfForMoveOutCase(state, caseRecord, getCentralServicesEmployees());
      } else {
        pushCaseActivity(caseRecord, `Inspection status changed to ${status}.`);
      }
    }
    addAudit(state, "Updated inspection status", { inspectionId: id, status });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsMarkInspectionSyncStatus = function (id, status) {
    const state = loadState();
    const inspection = findInspection(state, id);
    if (!inspection || !INSPECTION_SYNC_STATUSES.includes(status)) return;
    inspection.syncStatus = status;
    inspection.updatedAt = new Date().toISOString();
    pushInspectionAudit(inspection, `Sync status changed to ${status}.`);
    addAudit(state, "Updated inspection sync status", { inspectionId: id, status });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsUpdateInspectionField = function (id, field, value) {
    const state = loadState();
    const inspection = findInspection(state, id);
    if (!inspection) return;
    const allowed = new Set(["peopleInvolved", "witnesses", "policeReportNumber", "fireReportNumber", "narrative", "injuryInvolved", "insuranceClaim", "emergencyServicesContacted", "legalRiskEscalation"]);
    if (!allowed.has(field)) return;
    inspection[field] = cleanString(value);
    inspection.updatedAt = new Date().toISOString();
    pushInspectionAudit(inspection, `Updated ${field}.`);
    addAudit(state, "Updated inspection field", { inspectionId: id, field });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsAddInspectionFinding = function (inspectionId) {
    const state = loadState();
    const inspection = findInspection(state, inspectionId);
    if (!inspection) return;
    const room = getImportControlValue("atlas-cs-finding-room");
    const component = getImportControlValue("atlas-cs-finding-component");
    const condition = getImportControlValue("atlas-cs-finding-condition");
    if (!room || !component || !condition) {
      alert("Choose a room, component, and condition before adding the finding.");
      return;
    }
    const chargebackId = getImportControlValue("atlas-cs-finding-chargeback");
    const actionRouting = getImportControlValue("atlas-cs-finding-action") || "Recommendation Only";
    const finding = {
      id: makeId("finding", [inspection.id, room, component, Date.now()]),
      room,
      component,
      condition,
      notes: getImportControlValue("atlas-cs-finding-notes"),
      residentResponsibility: getImportControlValue("atlas-cs-finding-responsibility") || "Needs Review",
      chargebackId,
      actionRouting,
      canCompleteInHouse: getImportControlValue("atlas-cs-finding-inhouse") || "Yes",
      assignedParty: getImportControlValue("atlas-cs-finding-assignee"),
      aiSuggestedCondition: getImportControlValue("atlas-cs-finding-ai"),
      aiConfidence: whole(getImportControlValue("atlas-cs-finding-ai-confidence")),
      aiInspectorDecision: getImportControlValue("atlas-cs-finding-ai") ? "Not Reviewed" : "",
      photos: [],
      annotations: [],
      chargeAudit: [],
      createdAt: new Date().toISOString()
    };
    inspection.findings.unshift(finding);
    inspection.updatedAt = new Date().toISOString();
    pushInspectionAudit(inspection, "Finding added.", { room, component, condition });
    if (actionRouting === "Create Work Task / Escalation") {
      state.tasks.unshift({
        id: makeId("task", [inspection.id, finding.id, "inspection-escalation"]),
        sourceInspectionId: inspection.id,
        sourceFindingId: finding.id,
        type: "Inspection Escalation",
        propertyName: inspection.propertyName,
        residentName: inspection.residentName,
        title: `${component} follow-up in ${room}`,
        owner: finding.assignedParty || "Unassigned",
        dueDate: addBusinessDays(TODAY_ISO, 3),
        status: "Open",
        priority: condition === "Safety Concern" ? "Critical" : "Normal",
        createdAt: new Date().toISOString()
      });
    }
    addAudit(state, "Added inspection finding", { inspectionId: inspection.id, findingId: finding.id });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsUpdateFindingField = function (inspectionId, findingId, field, value) {
    const state = loadState();
    const inspection = findInspection(state, inspectionId);
    const finding = inspection?.findings?.find(item => item.id === findingId);
    if (!inspection || !finding) return;
    const allowed = new Set(["condition", "residentResponsibility", "chargebackId", "aiInspectorDecision"]);
    if (!allowed.has(field)) return;
    const oldValue = finding[field];
    finding[field] = cleanString(value);
    finding.chargeAudit = asArray(finding.chargeAudit);
    if (["residentResponsibility", "chargebackId"].includes(field)) {
      finding.chargeAudit.unshift({ at: new Date().toISOString(), label: `Updated ${field}.`, oldValue, newValue: finding[field] });
    }
    inspection.updatedAt = new Date().toISOString();
    pushInspectionAudit(inspection, `Updated finding ${field}.`, { findingId, oldValue, newValue: finding[field] });
    addAudit(state, "Updated inspection finding", { inspectionId, findingId, field });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsAttachInspectionPhotos = function (input, inspectionId, findingId) {
    const files = Array.from(input?.files || []);
    if (!files.length) return;
    const readFile = file => new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve({
        id: makeId("photo", [inspectionId, findingId, file.name, file.size, Date.now()]),
        fileName: file.name,
        type: file.type,
        size: file.size,
        dataUrl: reader.result,
        originalPreserved: true,
        annotations: [],
        capturedAt: new Date().toISOString()
      });
      reader.onerror = () => resolve({
        id: makeId("photo", [inspectionId, findingId, file.name, Date.now()]),
        fileName: file.name,
        type: file.type,
        size: file.size,
        dataUrl: "",
        originalPreserved: true,
        annotations: [],
        capturedAt: new Date().toISOString()
      });
      reader.readAsDataURL(file);
    });
    Promise.all(files.map(readFile)).then(photos => {
      const state = loadState();
      const inspection = findInspection(state, inspectionId);
      const finding = inspection?.findings?.find(item => item.id === findingId);
      if (!inspection || !finding) return;
      finding.photos = [...asArray(finding.photos), ...photos];
      inspection.syncStatus = "Saved Offline";
      inspection.updatedAt = new Date().toISOString();
      pushInspectionAudit(inspection, `Attached ${photos.length} photo${photos.length === 1 ? "" : "s"} to finding.`, { findingId });
      addAudit(state, "Attached inspection photos", { inspectionId, findingId, count: photos.length });
      saveState(state);
      renderActiveTab();
    });
    input.value = "";
  };

  window.atlasCsOverridePhotoRequirement = function (inspectionId, findingId) {
    const state = loadState();
    const inspection = findInspection(state, inspectionId);
    const finding = inspection?.findings?.find(item => item.id === findingId);
    if (!inspection || !finding) return;
    const reason = cleanString(prompt("Reason for overriding the photo requirement."));
    if (!reason) {
      alert("A reason is required to override the photo requirement.");
      return;
    }
    const user = cleanString(prompt("Authorized user approving the override.")) || "Authorized user";
    const authorizationLevel = cleanString(prompt("Authorization level.")) || "Admin/VP";
    finding.photoRequirementOverride = {
      reason,
      user,
      authorizationLevel,
      at: new Date().toISOString()
    };
    finding.chargeAudit = asArray(finding.chargeAudit);
    finding.chargeAudit.unshift({ at: new Date().toISOString(), label: "Photo requirement overridden.", reason, user, authorizationLevel });
    pushInspectionAudit(inspection, "Photo requirement overridden.", { findingId, reason, user, authorizationLevel });
    addAudit(state, "Overrode inspection photo requirement", { inspectionId, findingId, reason, user, authorizationLevel });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsDeleteInspectionFinding = function (inspectionId, findingId) {
    if (!confirm("Remove this inspection finding?")) return;
    const state = loadState();
    const inspection = findInspection(state, inspectionId);
    if (!inspection) return;
    inspection.findings = asArray(inspection.findings).filter(item => item.id !== findingId);
    pushInspectionAudit(inspection, "Inspection finding removed.", { findingId });
    addAudit(state, "Removed inspection finding", { inspectionId, findingId });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsAddPhotoAnnotation = function (inspectionId, findingId, photoId, tool) {
    const state = loadState();
    const inspection = findInspection(state, inspectionId);
    const finding = inspection?.findings?.find(item => item.id === findingId);
    const photo = finding?.photos?.find(item => item.id === photoId);
    if (!inspection || !finding || !photo) return;
    const note = tool === "Text" ? cleanString(prompt("Text annotation.")) : "";
    photo.annotations = asArray(photo.annotations);
    photo.annotations.push({
      id: makeId("annotation", [photoId, tool, Date.now()]),
      tool,
      note,
      originalPhotoId: photoId,
      createdAt: new Date().toISOString()
    });
    photo.annotatedCopyPreserved = true;
    pushInspectionAudit(inspection, `Added ${tool} photo annotation.`, { findingId, photoId });
    addAudit(state, "Added photo annotation", { inspectionId, findingId, photoId, tool });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsAddInspectionSignature = function (inspectionId, role) {
    const state = loadState();
    const inspection = findInspection(state, inspectionId);
    if (!inspection) return;
    if (role === "Resident" && inspection.residentPresent !== "Yes") {
      alert("Resident Not in Attendance. No resident signature is required.");
      return;
    }
    const name = cleanString(prompt(`${role} name for electronic signature.`));
    if (!name) return;
    inspection.signatures = asArray(inspection.signatures);
    inspection.signatures.push({
      id: makeId("sig", [inspectionId, role, name, Date.now()]),
      name,
      role,
      signature: `${name} / electronic acknowledgement`,
      at: new Date().toISOString(),
      deviceSession: navigator.userAgent || "ATLAS browser session"
    });
    pushInspectionAudit(inspection, `${role} signature captured.`, { name });
    addAudit(state, "Captured inspection signature", { inspectionId, role, name });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsSubmitInspection = function (inspectionId) {
    const state = loadState();
    const inspection = findInspection(state, inspectionId);
    if (!inspection) return;
    const missingPhotoCount = getInspectionMissingPhotoChargeCount(inspection);
    if (missingPhotoCount) {
      alert("Resident charge recommendations need photo support or an authorized override before submission.");
      return;
    }
    const template = getInspectionTemplateById(state, inspection.templateId);
    if (template.signatureRequirements?.inspector && !asArray(inspection.signatures).some(signature => signature.role === "Inspector")) {
      alert("Inspector signature is required before this inspection can be submitted.");
      return;
    }
    inspection.status = "Awaiting Review";
    inspection.syncStatus = inspection.syncStatus === "Successfully Synced" ? "Successfully Synced" : "Waiting to Sync";
    inspection.submittedAt = new Date().toISOString();
    pushInspectionAudit(inspection, "Inspection completed and submitted for approval.");
    const caseRecord = getInspectionRelatedCase(state, inspection);
    if (caseRecord) {
      caseRecord.inspectionStatus = "Awaiting Review";
      caseRecord.inspectionApprovalStatus = "Awaiting Review";
      caseRecord.inspectionCompletedAt = new Date().toISOString();
      stampLifecycle(caseRecord, "inspectionCompleted");
      setCaseWorkflowStatus(caseRecord, "Inspection Approval", "Inspection completed and moved to Inspection Approval.");
    }
    addAudit(state, "Submitted inspection", { inspectionId });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsApproveInspection = function (inspectionId) {
    const state = loadState();
    const inspection = findInspection(state, inspectionId);
    if (!inspection) return;
    const missingPhotoCount = getInspectionMissingPhotoChargeCount(inspection);
    if (missingPhotoCount) {
      alert("Resolve required photo documentation or override before approving.");
      return;
    }
    inspection.status = "Approved";
    inspection.approvedAt = new Date().toISOString();
    pushInspectionAudit(inspection, "Inspection reviewed and approved.");
    const caseRecord = getInspectionRelatedCase(state, inspection);
    if (caseRecord) {
      caseRecord.inspectionStatus = "Approved";
      caseRecord.inspectionApprovalStatus = "Approved";
      caseRecord.inspectionApprovedAt = new Date().toISOString();
      stampLifecycle(caseRecord, "inspectionApproved");
      setCaseWorkflowStatus(caseRecord, getActualPossessionDate(caseRecord) ? "MORF Ready" : "Inspection Approval", "Inspection approved; MORF is ready for processing.");
      if (getActualPossessionDate(caseRecord)) {
        const morf = ensureMorfForMoveOutCase(state, caseRecord, getCentralServicesEmployees());
        if (morf) {
          morf.status = "MORF Ready";
          morf.inspectionApprovalStatus = "Approved";
          morf.inspectionApprovalDate = inspection.approvedAt;
          morf.lifecycleTimestamps = asObject(morf.lifecycleTimestamps);
          morf.lifecycleTimestamps.morfReady = morf.lifecycleTimestamps.morfReady || new Date().toISOString();
          pushMorfAudit(morf, "Inspection approval released MORF for processing.", { inspectionId: inspection.id });
        }
      }
    }
    addAudit(state, "Approved inspection", { inspectionId });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsDownloadInspectionReport = function (inspectionId, mode) {
    const state = loadState();
    const inspection = findInspection(state, inspectionId);
    if (!inspection) return;
    const residentMode = mode === "resident";
    const payload = cloneJson(inspection);
    payload.reportMode = residentMode ? "Resident copy" : "Internal review copy";
    payload.riseBranding = "RISE-branded inspection report payload";
    if (residentMode) {
      payload.financialAmountsSuppressed = true;
      payload.findings = asArray(payload.findings).map(finding => ({
        ...finding,
        chargebackId: finding.chargebackId ? "Charge review pending after MORF processing" : "",
        inspectorRecommendedAmount: "",
        chargeAudit: []
      }));
    }
    downloadJson(`atlas-${residentMode ? "resident" : "internal"}-inspection-${inspection.id}.json`, payload);
  };

  window.atlasCsHandleRenewalUpload = async function (input) {
    const file = input?.files?.[0];
    if (!file) return;
    const propertyName = getImportControlValue("atlas-cs-renewal-property");
    if (!propertyName || propertyName === "all") {
      alert("Choose the ATLAS property for this renewal report before importing.");
      input.value = "";
      return;
    }
    const monthIdx = Math.max(0, Math.min(11, Number(getImportControlValue("atlas-cs-renewal-month")) || 0));
    const year = Number(getImportControlValue("atlas-cs-renewal-year")) || new Date().getFullYear();
    const state = loadState();
    const employees = getCentralServicesEmployees();
    try {
      const rows = await parseRenewalFile(file, { propertyName, monthIdx, year, fileName: file.name }, employees);
      if (!rows.length) {
        alert("No resident-level renewal rows could be imported. Check that the file includes resident name, unit, and lease expiration columns.");
        input.value = "";
        return;
      }
      upsertRenewals(state, rows);
      createMoveOutCasesForNtvRows(state, rows);
      syncRenewalSummaryToAtlas(propertyName, monthIdx, year, state);
      state.importHistory.unshift({
        id: makeId("import", [file.name, propertyName, Date.now()]),
        importedAt: new Date().toISOString(),
        fileName: file.name,
        propertyName,
        monthIdx,
        year,
        rowCount: rows.length,
        ntvCount: rows.filter(renewalIsNtv).length,
        source: "Entrata renewal report upload"
      });
      state.importHistory = state.importHistory.slice(0, 50);
      state.ui.module = "renewals";
      state.ui.propertyId = propertyName;
      state.ui.monthIdx = monthIdx;
      state.ui.year = year;
      addAudit(state, "Imported renewal report", { propertyName, fileName: file.name, rows: rows.length });
      saveState(state);
      input.value = "";
      renderActiveTab();
    } catch (error) {
      alert(`Renewal import failed: ${error?.message || error}`);
      input.value = "";
    }
  };

  window.atlasCsSelectMoveOut = function (id) {
    const state = loadState();
    state.ui.selectedMoveOutId = cleanString(id);
    state.ui.module = "moveOuts";
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsUpdateMoveOutField = function (id, field, value) {
    const state = loadState();
    const item = findMoveOutCase(state, id);
    if (!item || !["notes", "scheduledMoveOutDate", "inspectionDate", "anticipatedPossessionDate", "forwardingAddress"].includes(field)) return;
    const previous = item[field];
    item[field] = ["scheduledMoveOutDate", "inspectionDate", "anticipatedPossessionDate"].includes(field) ? normalizeDate(value) : cleanString(value);
    if (field === "scheduledMoveOutDate" && !getActualPossessionDate(item)) {
      item.inspectionDate = calculateDefaultInspectionDate(state, item);
      item.inspectionStatus = isHoldOverCase(item) ? "HOLD - POSSESSION NOT RETURNED" : "Inspection Scheduled";
      if (!isHoldOverCase(item)) setCaseWorkflowStatus(item, "Upcoming Move Out", "Scheduled move-out date updated; default inspection date recalculated.", { previousValue: previous, newValue: item[field] });
    }
    pushCaseActivity(item, `Updated ${field}.`);
    addAudit(state, "Updated move-out case", { id, field });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsSendMog = function (id) {
    const state = loadState();
    const item = findMoveOutCase(state, id);
    if (!item) return;
    item.mogStatus = "Awaiting Signature";
    setCaseWorkflowStatus(item, "On Notice", "MOG marked as sent and awaiting resident signature.");
    addAudit(state, "Sent MOG", { id });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsCompleteMog = function (id) {
    const state = loadState();
    const item = findMoveOutCase(state, id);
    if (!item) return;
    const forwardingAddress = prompt("Enter the forwarding address captured on the signed MOG.");
    if (!cleanString(forwardingAddress)) {
      alert("The signed MOG needs a forwarding address before this step can be completed.");
      return;
    }
    item.forwardingAddress = cleanString(forwardingAddress);
    item.mogStatus = "Completed";
    item.mogCompletedAt = new Date().toISOString();
    setCaseWorkflowStatus(item, item.scheduledMoveOutDate ? "Upcoming Move Out" : "On Notice", "MOG completed with forwarding address.");
    addAudit(state, "Completed MOG", { id });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsScheduleInspection = function (id) {
    const state = loadState();
    const item = findMoveOutCase(state, id);
    if (!item) return;
    const date = normalizeDate(prompt("Enter the inspection date (for example, 2026-09-15)."));
    if (!date) {
      alert("Enter a valid inspection date to schedule the inspection.");
      return;
    }
    item.inspectionDate = date;
    item.inspectionStatus = isHoldOverCase(item) ? "HOLD - POSSESSION NOT RETURNED" : "Inspection Scheduled";
    setCaseWorkflowStatus(item, getActualPossessionDate(item) ? "Move-Out Inspection" : isHoldOverCase(item) ? "Inspection Hold - Possession Not Returned" : "Upcoming Move Out", `Inspection scheduled for ${date}.`);
    addAudit(state, "Scheduled inspection", { id, date });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsCreateInspectionFromMoveOut = function (id) {
    const state = loadState();
    const item = findMoveOutCase(state, id);
    if (!item) return;
    if (!getActualPossessionDate(item)) {
      item.inspectionStatus = "HOLD - POSSESSION NOT RETURNED";
      setCaseWorkflowStatus(item, shouldMoveToHoldover(state, item) ? "Hold Over / Past Due Move Out" : "Inspection Hold - Possession Not Returned", "Inspection cannot proceed until actual possession is confirmed.");
      const holdInspection = createMoveOutInspection(state, item, getCentralServicesEmployees());
      state.ui.module = "moveOuts";
      state.ui.selectedMoveOutId = item.id;
      addAudit(state, "Blocked move-out inspection before possession confirmation", { caseId: id, inspectionId: holdInspection?.id });
      saveState(state);
      renderActiveTab();
      alert("Actual possession must be confirmed before this move-out inspection can proceed.");
      return;
    }
    const inspection = createMoveOutInspection(state, item, getCentralServicesEmployees());
    state.ui.module = "inspections";
    state.ui.selectedInspectionId = inspection.id;
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsAssignInspector = function (id) {
    const state = loadState();
    const item = findMoveOutCase(state, id);
    if (!item) return;
    const search = cleanString(prompt("Search active inspection-eligible technicians by name, property, position, region, or portfolio.", item.inspectorName || ""));
    if (!search) return;
    const query = normalizeKey(search);
    const eligible = getInspectionEligibleEmployees(state)
      .filter(employee => employeeInspectionSearchText(employee).includes(query))
      .sort((left, right) => {
        const leftProperty = employeeMatchesProperty(left, item.propertyName) ? 0 : normalizeKey(employeeRegion(left)) === normalizeKey(propertyRegion(item.propertyName)) ? 1 : 2;
        const rightProperty = employeeMatchesProperty(right, item.propertyName) ? 0 : normalizeKey(employeeRegion(right)) === normalizeKey(propertyRegion(item.propertyName)) ? 1 : 2;
        return leftProperty - rightProperty || left.name.localeCompare(right.name);
      });
    if (!eligible.length) {
      alert("No active inspection-eligible People employees matched that search.");
      return;
    }
    const selected = eligible.length === 1
      ? eligible[0]
      : eligible[Math.max(0, Math.min(eligible.length - 1, Number(prompt(`Choose technician number:\n${eligible.slice(0, 8).map((employee, index) => `${index + 1}. ${inspectionEmployeeOptionLabel(employee)}`).join("\n")}`, "1")) - 1))];
    if (!selected) return;
    const inspection = getMoveOutInspectionForCase(state, item) || createMoveOutInspection(state, item, getCentralServicesEmployees());
    const prior = inspection?.inspectorName || item.inspectorName || "Unassigned";
    const reason = prior && prior !== "Unassigned" && prior !== selected.name
      ? cleanString(prompt("Reason for reassignment.", "Temporary cross-property support"))
      : "Inspection assignment from People roster";
    applyInspectionAssignment(state, item, inspection, selected, reason);
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsRescheduleInspection = function (id) {
    const state = loadState();
    const item = findMoveOutCase(state, id);
    if (!item) return;
    const date = normalizeDate(prompt("New inspection date."));
    if (!date) {
      alert("Enter a valid inspection date.");
      return;
    }
    item.inspectionDate = date;
    const inspection = getMoveOutInspectionForCase(state, item);
    if (inspection) {
      inspection.inspectionDate = date;
      inspection.updatedAt = new Date().toISOString();
      pushInspectionAudit(inspection, `Inspection rescheduled for ${date}.`);
    }
    if (!getActualPossessionDate(item)) {
      item.inspectionStatus = "HOLD - POSSESSION NOT RETURNED";
      setCaseWorkflowStatus(item, "Inspection Hold - Possession Not Returned", `Inspection date adjusted to ${date}; possession remains unconfirmed.`);
    } else {
      item.inspectionStatus = "Inspection Scheduled";
      setCaseWorkflowStatus(item, "Move-Out Inspection", `Inspection rescheduled for ${date}.`);
    }
    addAudit(state, "Rescheduled move-out inspection", { caseId: id, date });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsConfirmPossession = function (id) {
    const state = loadState();
    const item = findMoveOutCase(state, id);
    if (!item) return;
    const date = normalizeDate(prompt("Enter the Actual Possession Returned Date."));
    if (!date) {
      alert("Actual Possession Returned Date is required before possession can be confirmed.");
      return;
    }
    const employees = getCentralServicesEmployees();
    let morf = confirmPossessionForCase(state, item, date, employees);
    const inspection = createMoveOutInspection(state, item, employees);
    morf = ensureMorfForMoveOutCase(state, item, employees) || morf;
    state.ui.module = "inspections";
    state.ui.selectedInspectionId = inspection?.id || "";
    state.ui.selectedMorfId = morf?.id || "";
    addAudit(state, "Marked possession returned", { caseId: id, possessionReturnedDate: date });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsMarkPossessionReturned = window.atlasCsConfirmPossession;

  window.atlasCsCreateResidentNotification = function (id) {
    const state = loadState();
    const item = findMoveOutCase(state, id);
    if (!item) return;
    const actor = currentActor();
    const propertyEmail = item.communityEmail || getCommunityEmail(item.propertyName);
    const emailSubject = `Possession Return Needed - ${item.propertyName} Unit ${item.unit || ""}`.trim();
    const emailBody = [
      `Hello ${item.residentName || "Resident"},`,
      "",
      `Our records show your scheduled move-out date for ${item.propertyName}, Unit ${item.unit || "n/a"}, has passed or is approaching, but possession has not been confirmed as returned.`,
      "Please contact the community team to confirm key return, access devices, and possession status.",
      "",
      "Thank you,"
    ].join("\n");
    const smsBody = `ATLAS notice: Please contact ${item.propertyName} to confirm possession/key return for Unit ${item.unit || "n/a"}.`;
    const communication = {
      id: makeId("communication", [id, Date.now(), item.email, item.phone]),
      type: "Resident Notification",
      status: "Draft",
      createdAt: new Date().toISOString(),
      createdBy: actor.name,
      userId: actor.userId,
      emailTo: item.email || "",
      emailCc: propertyEmail || "",
      emailSubject,
      emailBody,
      smsTo: item.phone || "",
      smsBody,
      textingIntegrationRequired: true
    };
    item.communications = asArray(item.communications);
    item.communications.unshift(communication);
    item.lastResidentCommunication = communication.createdAt;
    item.communicationStatus = "Draft Created";
    if (isHoldOverCase(item)) {
      setCaseWorkflowStatus(item, "Inspection Hold - Possession Not Returned", "Resident notification draft created while inspection remains on possession hold.");
    } else {
      pushCaseActivity(item, "Resident notification draft created.");
    }
    addAudit(state, "Created resident notification draft", { caseId: id, emailTo: communication.emailTo, emailCc: communication.emailCc });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsAdjustHoldoverDates = function (id) {
    const state = loadState();
    const item = findMoveOutCase(state, id);
    if (!item) return;
    const anticipated = normalizeDate(prompt("Anticipated possession date."));
    const inspectionDate = normalizeDate(prompt("Adjusted scheduled inspection date."));
    const note = cleanString(prompt("Reason or note for the date adjustment."));
    if (!anticipated && !inspectionDate && !note) return;
    item.anticipatedPossessionDate = anticipated || item.anticipatedPossessionDate;
    item.inspectionDate = inspectionDate || item.inspectionDate;
    item.inspectionStatus = "HOLD - POSSESSION NOT RETURNED";
    item.dateAdjustments = asArray(item.dateAdjustments);
    item.dateAdjustments.unshift({
      id: makeId("date_adjustment", [id, anticipated, inspectionDate, Date.now()]),
      at: new Date().toISOString(),
      user: currentActor().name,
      anticipatedPossessionDate: anticipated,
      inspectionDate,
      note
    });
    setCaseWorkflowStatus(item, "Inspection Hold - Possession Not Returned", "Holdover dates adjusted; record remains in Hold Over until possession is confirmed.", { memo: note });
    addAudit(state, "Adjusted holdover dates", { caseId: id, anticipatedPossessionDate: anticipated, inspectionDate });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsAddLifecycleMemo = function (id) {
    const state = loadState();
    const item = findMoveOutCase(state, id);
    if (!item) return;
    const memo = cleanString(prompt("Add lifecycle memo."));
    if (!memo) return;
    const actor = currentActor();
    item.memos = asArray(item.memos);
    item.memos.unshift({
      id: makeId("memo", [id, Date.now(), memo]),
      at: new Date().toISOString(),
      user: actor.name,
      userId: actor.userId,
      memo
    });
    pushCaseActivity(item, "Lifecycle memo added.", { memo });
    addAudit(state, "Added lifecycle memo", { caseId: id });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsOpenMorfForCase = function (id) {
    const state = loadState();
    const item = findMoveOutCase(state, id);
    if (!item) return;
    if (!getActualPossessionDate(item)) {
      alert("Confirm the Actual Possession Returned Date before opening the MORF.");
      return;
    }
    const morf = ensureMorfForMoveOutCase(state, item, getCentralServicesEmployees());
    state.ui.module = "morfs";
    state.ui.selectedMorfId = morf?.id || "";
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsCompleteInspection = function (id) {
    const state = loadState();
    const item = findMoveOutCase(state, id);
    if (!item) return;
    if (!getActualPossessionDate(item)) {
      item.possessionStatus = "Not Returned";
      item.inspectionStatus = "HOLD - POSSESSION NOT RETURNED";
      setCaseWorkflowStatus(item, "Inspection Hold - Possession Not Returned", "Inspection completion blocked because actual possession has not been confirmed.");
      addAudit(state, "Blocked inspection completion pending possession", { id });
      saveState(state);
      renderActiveTab();
      alert("Actual possession returned date is required before completing the move-out inspection.");
      return;
    }
    const inspection = createMoveOutInspection(state, item, getCentralServicesEmployees());
    if (inspection) {
      inspection.status = "Awaiting Review";
      inspection.syncStatus = inspection.syncStatus === "Successfully Synced" ? "Successfully Synced" : "Waiting to Sync";
      inspection.submittedAt = new Date().toISOString();
      inspection.updatedAt = new Date().toISOString();
      pushInspectionAudit(inspection, "Inspection marked complete from move-out lifecycle record.");
    }
    item.inspectionStatus = "Awaiting Review";
    item.inspectionApprovalStatus = "Awaiting Review";
    setCaseWorkflowStatus(item, "Inspection Approval", "Inspection marked complete and moved to Inspection Approval.");
    item.inspectionCompletedAt = new Date().toISOString();
    stampLifecycle(item, "inspectionCompleted");
    addAudit(state, "Completed inspection", { id });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsSelectMorf = function (id) {
    const state = loadState();
    state.ui.selectedMorfId = cleanString(id);
    state.ui.module = "morfs";
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsUpdateMorfField = function (id, field, value) {
    const state = loadState();
    const morf = findMorf(state, id);
    if (!morf) return;
    const allowed = new Set(["status", "processor", "forwardingAddress"]);
    if (!allowed.has(field)) return;
    const oldValue = morf[field];
    morf[field] = field === "status" && MORF_STATUSES.includes(value) ? value : cleanString(value);
    if (field === "forwardingAddress") {
      const address = cleanString(value);
      const existing = morf.forwardingAddresses.find(item => item.type === "Primary");
      if (existing) existing.address = address;
      else if (address) morf.forwardingAddresses.unshift({ id: makeId("addr", [morf.id, address]), type: "Primary", address });
      const caseRecord = getMorfRelatedCase(state, morf);
      if (caseRecord) {
        caseRecord.forwardingAddress = address;
        pushCaseActivity(caseRecord, "Forwarding address updated from MORF.");
      }
    }
    if (field === "status") {
      const caseRecord = getMorfRelatedCase(state, morf);
      if (caseRecord) {
        if (["MORF Ready", "Ready for MORF"].includes(morf.status)) setCaseWorkflowStatus(caseRecord, "MORF Ready", "MORF status moved to ready.");
        else if (morf.status === "MORF In Progress") setCaseWorkflowStatus(caseRecord, "MORF In Progress", "MORF processing started.");
        else if (["Waiting on Site", "Waiting on Utilities", "Waiting on Documentation", "Waiting on Information", "Legal Deadline Risk"].includes(morf.status)) pushCaseActivity(caseRecord, `MORF status changed to ${morf.status}.`);
        else if (["Approved", "MORF Finalized"].includes(morf.status)) setCaseWorkflowStatus(caseRecord, "MORF Finalized", "MORF finalized.");
        else if (morf.status === "Sent to Accounting") setCaseWorkflowStatus(caseRecord, "Sent to Accounting", "MORF sent to Accounting.");
      }
    }
    pushMorfAudit(morf, `Updated ${field}.`, { oldValue, newValue: morf[field] });
    addAudit(state, "Updated MORF field", { morfId: id, field });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsStartMorfProcessing = function (morfId) {
    const state = loadState();
    const morf = findMorf(state, morfId);
    if (!morf) return;
    morf.status = "MORF In Progress";
    morf.startedAt = morf.startedAt || new Date().toISOString();
    morf.lifecycleTimestamps = asObject(morf.lifecycleTimestamps);
    morf.lifecycleTimestamps.morfProcessingStarted = morf.lifecycleTimestamps.morfProcessingStarted || morf.startedAt;
    const caseRecord = getMorfRelatedCase(state, morf);
    if (caseRecord) setCaseWorkflowStatus(caseRecord, "MORF In Progress", "Central Services started MORF processing.");
    pushMorfAudit(morf, "Central Services processor started MORF processing.");
    addAudit(state, "Started MORF processing", { morfId });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsToggleMorfValidation = function (morfId, field, checked) {
    const state = loadState();
    const morf = findMorf(state, morfId);
    const allowed = new Set(["chargesReviewed", "depositVerified", "utilitiesReviewed", "ledgerReviewed", "calculationConfirmed"]);
    if (!morf || !allowed.has(field)) return;
    morf[field] = Boolean(checked);
    pushMorfAudit(morf, `${field.replace(/([A-Z])/g, " $1")} ${checked ? "confirmed" : "cleared"}.`);
    addAudit(state, "Updated MORF completion validation", { morfId, field, checked: Boolean(checked) });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsGenerateMorfArtifacts = function (morfId) {
    const state = loadState();
    const morf = findMorf(state, morfId);
    if (!morf) return;
    if (!["MORF Finalized", "Approved", "Sent to Accounting", "Archived / Open", "MORF Closed"].includes(morf.status)) {
      alert("Finalize the MORF before generating the final accounting and resident statement package.");
      return;
    }
    morf.generatedArtifacts = asArray(morf.generatedArtifacts);
    const generatedAt = new Date().toISOString();
    ["Internal/Accounting MORF", "Statement of Deposit Accounting", "Turn / Damage Statement"].forEach(label => {
      if (!morf.generatedArtifacts.some(item => item.label === label)) {
        morf.generatedArtifacts.push({
          id: makeId("artifact", [morfId, label]),
          label,
          status: "Generated",
          generatedAt
        });
      }
    });
    morf.packetSelections = uniqueStrings([...asArray(morf.packetSelections), "Internal/Accounting MORF", "Statement of Deposit Accounting", "Turn / Damage Statement"]);
    pushMorfAudit(morf, "Generated MORF accounting, resident statement, and turn/damage package records.");
    addAudit(state, "Generated MORF package records", { morfId });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsUpdateMorfCharge = function (morfId, chargeId, field, value) {
    const state = loadState();
    const morf = findMorf(state, morfId);
    const charge = morf?.charges?.find(item => item.id === chargeId);
    if (!morf || !charge || !["finalAmount", "adjustmentReason"].includes(field)) return;
    const oldValue = charge[field];
    charge[field] = field === "finalAmount" ? numberValue(value) : cleanString(value);
    charge.audit = asArray(charge.audit);
    charge.audit.unshift({ at: new Date().toISOString(), label: `Updated ${field}.`, oldValue, newValue: charge[field] });
    pushMorfAudit(morf, `Updated charge ${field}.`, { chargeId, oldValue, newValue: charge[field] });
    addAudit(state, "Updated MORF charge", { morfId, chargeId, field });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsAddMorfLine = function (morfId, kind) {
    const state = loadState();
    const morf = findMorf(state, morfId);
    if (!morf || !["deposits", "credits", "finalUtilities", "finalRent", "recurringCharges", "pastDueCharges"].includes(kind)) return;
    const description = cleanString(prompt("Line description."));
    if (!description) return;
    const amount = numberValue(prompt("Amount."));
    morf[kind] = asArray(morf[kind]);
    morf[kind].push({
      id: makeId("line", [morfId, kind, description, Date.now()]),
      description,
      amount,
      source: "Manual entry pending Entrata integration",
      createdAt: new Date().toISOString()
    });
    if (kind === "deposits") morf.depositVerified = true;
    if (kind === "finalUtilities") morf.utilitiesReviewed = true;
    if (["finalRent", "recurringCharges", "pastDueCharges"].includes(kind)) morf.ledgerReviewed = true;
    pushMorfAudit(morf, `Added ${kind} line.`, { description, amount });
    addAudit(state, "Added MORF ledger line", { morfId, kind, description, amount });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsToggleMorfPacket = function (morfId, option, checked) {
    const state = loadState();
    const morf = findMorf(state, morfId);
    if (!morf) return;
    const selected = new Set(asArray(morf.packetSelections));
    if (checked) selected.add(option);
    else selected.delete(option);
    morf.packetSelections = [...selected];
    pushMorfAudit(morf, `${checked ? "Selected" : "Removed"} accounting packet attachment.`, { option });
    addAudit(state, "Updated MORF accounting packet", { morfId, option, checked });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsUpdateMorfDelivery = function (morfId, field, value) {
    const state = loadState();
    const morf = findMorf(state, morfId);
    if (!morf) return;
    morf.delivery = asObject(morf.delivery);
    morf.delivery[field] = cleanString(value);
    pushMorfAudit(morf, `Updated delivery field ${field}.`);
    addAudit(state, "Updated MORF delivery", { morfId, field });
    saveState(state);
  };

  window.atlasCsGenerateStatement = function (morfId) {
    const state = loadState();
    const morf = findMorf(state, morfId);
    if (!morf) return;
    const rule = getStateComplianceRuleForProperty(state, morf.propertyName);
    if (!rule?.requiredStatutoryWording || !rule?.depositAccountingDeadlineDays) {
      alert("State-specific legal wording and deadline configuration are required before generating a resident-facing statement.");
      return;
    }
    const totals = getMorfTotals(morf);
    const versionNumber = asArray(morf.statementVersions).length + 1;
    morf.statementVersions.push({
      id: makeId("statement", [morfId, versionNumber, Date.now()]),
      versionLabel: `Version ${versionNumber}`,
      status: "Draft",
      statementDate: TODAY_ISO,
      stateRuleId: rule.id,
      legalWordingVersion: rule.version,
      totalRefundableDeposits: totals.deposits,
      lawfulDeductions: totals.lawfulDeductions,
      credits: totals.credits,
      balanceDueToResident: totals.balanceDueToResident,
      balanceDueToProperty: totals.balanceDueToProperty,
      createdAt: new Date().toISOString()
    });
    pushMorfAudit(morf, "Statement of Deposit Accounting version generated.", { versionNumber, stateRuleId: rule.id });
    addAudit(state, "Generated deposit accounting statement", { morfId, versionNumber });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsCreateDisputeFromMorf = function (morfId) {
    const state = loadState();
    const morf = findMorf(state, morfId);
    if (!morf) return;
    const eligibility = getDisputeEligibility(state, morf);
    if (!eligibility.eligible) {
      alert(eligibility.label);
      return;
    }
    const existing = state.residentDisputes.find(dispute => dispute.morfId === morfId && !["Final / Locked", "Dispute Closed", "MORF Closed"].includes(dispute.status));
    if (existing) {
      state.ui.module = "disputes";
      state.ui.selectedDisputeId = existing.id;
      saveState(state);
      renderActiveTab();
      return;
    }
    const totals = getMorfTotals(morf);
    const reason = cleanString(prompt("Dispute or review reason.")) || "Resident dispute / Central Services review";
    const dispute = normalizeDisputeRecord({
      id: makeId("dispute", [morfId, Date.now()]),
      morfId,
      moveOutCaseId: morf.moveOutCaseId,
      propertyName: morf.propertyName,
      unit: morf.unit,
      residentName: morf.residentName,
      status: "Dispute Open",
      reason,
      originalAmount: totals.balanceDueToProperty || totals.balanceDueToResident,
      currentAmount: totals.balanceDueToProperty || totals.balanceDueToResident,
      statementVersion: asArray(morf.statementVersions)[asArray(morf.statementVersions).length - 1]?.versionLabel || "Version 1",
      disputeEligibleThrough: eligibility.through,
      versions: [{
        at: new Date().toISOString(),
        label: "Dispute opened.",
        originalAmount: totals.balanceDueToProperty || totals.balanceDueToResident,
        reason
      }],
      correspondence: [],
      audit: []
    });
    state.residentDisputes.unshift(dispute);
    morf.status = "Dispute Open";
    morf.archiveStatus = "Dispute Open";
    morf.disputeStatus = "Dispute Open";
    pushMorfAudit(morf, "Resident dispute opened.", { disputeId: dispute.id, reason });
    addAudit(state, "Created resident dispute", { morfId, disputeId: dispute.id });
    state.ui.module = "disputes";
    state.ui.selectedDisputeId = dispute.id;
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsFinalizeMorf = function (morfId) {
    const state = loadState();
    const morf = findMorf(state, morfId);
    if (!morf) return;
    const relatedCase = getMorfRelatedCase(state, morf);
    if (relatedCase) {
      morf.internalDueDate = calculateInternalMorfDueDate(state, relatedCase) || morf.internalDueDate;
      morf.legalDeadline = calculateLegalDeadlineForCase(state, relatedCase) || morf.legalDeadline;
      morf.inspectionApprovalStatus = caseInspectionIsApproved(state, relatedCase) ? "Approved" : morf.inspectionApprovalStatus;
    }
    const missing = getMorfCompletionMissing(state, morf);
    if (missing.length) {
      alert(`Finalize MORF is blocked until these requirements are complete: ${missing.join(", ")}`);
      return;
    }
    const timing = calculateAccountingTiming(morf);
    morf.status = "MORF Finalized";
    morf.finalizedAt = new Date().toISOString();
    morf.approvedAt = morf.finalizedAt;
    morf.estimatedAccountingSendByDate = timing.estimatedSendByDate;
    morf.accountingTimeRemainingDays = timing.accountingTimeRemainingDays;
    morf.generatedArtifacts = asArray(morf.generatedArtifacts);
    ["Internal/Accounting MORF", "Statement of Deposit Accounting", "Turn / Damage Statement"].forEach(label => {
      if (!morf.generatedArtifacts.some(item => item.label === label)) {
        morf.generatedArtifacts.push({
          id: makeId("artifact", [morfId, label]),
          label,
          status: "Generated",
          generatedAt: morf.finalizedAt
        });
      }
    });
    morf.lifecycleTimestamps = asObject(morf.lifecycleTimestamps);
    morf.lifecycleTimestamps.morfFinalized = morf.lifecycleTimestamps.morfFinalized || morf.finalizedAt;
    const caseRecord = getMorfRelatedCase(state, morf);
    if (caseRecord) {
      caseRecord.morfSodaStatus = "MORF Finalized";
      setCaseWorkflowStatus(caseRecord, "MORF Finalized", "Central Services finalized MORF.", { newStatus: "MORF Finalized" });
    }
    pushMorfAudit(morf, "MORF finalized by Central Services processor.", { estimatedAccountingSendByDate: timing.estimatedSendByDate, accountingTimeRemainingDays: timing.accountingTimeRemainingDays });
    addAudit(state, "Finalized MORF", { morfId });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsSendMorfAccountingPacket = function (morfId) {
    const state = loadState();
    const morf = findMorf(state, morfId);
    if (!morf) return;
    if (!["MORF Finalized", "Approved", "Sent to Accounting"].includes(morf.status)) {
      alert("Finalize the MORF before sending the Accounting packet.");
      return;
    }
    if (!asArray(morf.packetSelections).length) {
      alert("Select at least one attachment for the accounting packet.");
      return;
    }
    const caseRecord = findMoveOutCase(state, morf.moveOutCaseId) || morf;
    const contact = getAccountingContactForCase(state, caseRecord);
    if (!contact) {
      alert("Add the real accounting contact in Central Services Settings before sending this MORF.");
      state.ui.module = "settings";
      saveState(state);
      renderActiveTab();
      return;
    }
    const actor = currentActor();
    const totals = getMorfTotals(morf);
    const timing = calculateAccountingTiming(morf);
    const emailTemplate = buildAccountingEmailTemplate(state, morf, contact);
    const sentAt = new Date().toISOString();
    morf.accountingHandoffStatus = "Sent to Accounting";
    morf.accountingContactName = contact.name;
    morf.accountingContactEmail = contact.email;
    morf.status = "Sent to Accounting";
    morf.accountingSentAt = sentAt;
    morf.archivedAt = sentAt;
    morf.archiveStatus = "Sent to Accounting / Open";
    morf.accountingHandoff = {
      userName: actor.name,
      userId: actor.userId,
      sentAt,
      accountingEmailAddress: contact.email,
      accountingContactName: contact.name,
      attachmentsIncluded: asArray(morf.packetSelections),
      refundAmount: totals.balanceDueToResident,
      balanceDue: totals.balanceDueToProperty,
      stateDeadline: morf.legalDeadline,
      estimatedSendByDate: timing.estimatedSendByDate,
      accountingTimeRemainingDays: timing.accountingTimeRemainingDays,
      emailSubject: emailTemplate.subject,
      emailBody: emailTemplate.body
    };
    morf.lifecycleTimestamps = asObject(morf.lifecycleTimestamps);
    morf.lifecycleTimestamps.sentToAccounting = morf.lifecycleTimestamps.sentToAccounting || sentAt;
    caseRecord.accountingStatus = "Sent to Accounting";
    caseRecord.accountingContactName = contact.name;
    caseRecord.accountingContactEmail = contact.email;
    caseRecord.accountingHandoff = morf.accountingHandoff;
    setCaseWorkflowStatus(caseRecord, "Archived / Open", `MORF sent to Accounting contact ${contact.name} (${contact.email}) and archived for follow-up.`, { newStatus: "Archived / Open" });
    pushMorfAudit(morf, `Accounting packet sent to ${contact.name} (${contact.email}).`, { packetSelections: morf.packetSelections, accountingTimeRemainingDays: timing.accountingTimeRemainingDays });
    addAudit(state, "Sent MORF accounting packet", { morfId, contact: contact.email });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsLockMorf = function (morfId) {
    const state = loadState();
    const morf = findMorf(state, morfId);
    if (!morf) return;
    const reason = cleanString(prompt("Reason for locking this record."));
    if (!reason) {
      alert("A lock reason is required.");
      return;
    }
    morf.status = "MORF Closed";
    morf.archiveStatus = "MORF Closed";
    morf.lockedAt = new Date().toISOString();
    morf.lockReason = reason;
    morf.lifecycleTimestamps = asObject(morf.lifecycleTimestamps);
    morf.lifecycleTimestamps.morfClosed = morf.lifecycleTimestamps.morfClosed || morf.lockedAt;
    const caseRecord = getMorfRelatedCase(state, morf);
    if (caseRecord) setCaseWorkflowStatus(caseRecord, "MORF Closed", "MORF closed and locked.", { memo: reason });
    pushMorfAudit(morf, "MORF locked.", { reason });
    addAudit(state, "Locked MORF", { morfId, reason });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsAddMorfForwardingAddress = function (morfId) {
    const state = loadState();
    const morf = findMorf(state, morfId);
    if (!morf) return;
    const address = cleanString(prompt("Additional forwarding address."));
    if (!address) return;
    morf.forwardingAddresses.push({ id: makeId("addr", [morfId, address, Date.now()]), type: "Secondary", address });
    pushMorfAudit(morf, "Added additional forwarding address.", { address });
    addAudit(state, "Added MORF forwarding address", { morfId });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsSetMogMethod = function (morfId, method) {
    const state = loadState();
    const morf = findMorf(state, morfId);
    if (!morf) return;
    morf.mogMethod = cleanString(method);
    pushMorfAudit(morf, `MOG method set to ${method}.`);
    addAudit(state, "Updated MOG method", { morfId, method });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsUploadMog = function (input, morfId) {
    const file = input?.files?.[0];
    if (!file) return;
    const state = loadState();
    const morf = findMorf(state, morfId);
    if (!morf) return;
    morf.mogUploads = asArray(morf.mogUploads);
    const upload = {
      id: makeId("mog", [morfId, file.name, file.size, Date.now()]),
      fileName: file.name,
      type: file.type,
      size: file.size,
      uploadedAt: new Date().toISOString(),
      originalStored: true,
      extractedDataEditable: true
    };
    morf.mogUploads.push(upload);
    morf.mogMethod = "Upload Existing MOG";
    const caseRecord = getMorfRelatedCase(state, morf);
    if (caseRecord) {
      caseRecord.mogUploads = asArray(caseRecord.mogUploads);
      caseRecord.mogUploads.push(upload);
      caseRecord.mogStatus = "Uploaded";
      pushCaseActivity(caseRecord, "Uploaded MOG document metadata.");
    }
    pushMorfAudit(morf, "Uploaded MOG document metadata.", { fileName: file.name });
    addAudit(state, "Uploaded MOG", { morfId, fileName: file.name });
    saveState(state);
    input.value = "";
    renderActiveTab();
  };

  window.atlasCsSendToAccounting = function (id) {
    const state = loadState();
    const item = findMoveOutCase(state, id);
    if (!item) return;
    const morf = getMorfForCase(state, item.id);
    if (!morf) {
      alert("Open the MORF and complete finalization before sending this lifecycle to Accounting.");
      state.ui.module = "morfs";
      state.ui.selectedMoveOutId = item.id;
      saveState(state);
      renderActiveTab();
      return;
    }
    state.ui.module = "morfs";
    state.ui.selectedMorfId = morf.id;
    saveState(state);
    if (!["MORF Finalized", "Approved", "Sent to Accounting"].includes(morf.status)) {
      alert("Finalize the MORF before sending to Accounting.");
      renderActiveTab();
      return;
    }
    window.atlasCsSendMorfAccountingPacket(morf.id);
  };

  window.atlasCsDownloadCasePacket = function (id) {
    const state = loadState();
    const item = findMoveOutCase(state, id);
    if (!item) return;
    downloadJson(`central-services-${item.propertyName}-${item.unit || item.id}.json`.replace(/[^a-z0-9_.-]+/gi, "-"), item);
  };

  window.atlasCsOpenTask = function (id) {
    const state = loadState();
    const task = state.tasks.find(item => item.id === id);
    if (!task) return;
    state.ui.selectedTaskId = id;
    if (task.sourceMorfId) {
      state.ui.module = "morfs";
      state.ui.selectedMorfId = task.sourceMorfId;
    } else if (task.sourceInspectionId) {
      state.ui.module = "inspections";
      state.ui.selectedInspectionId = task.sourceInspectionId;
    } else if (task.sourceCaseId) {
      state.ui.module = "moveOuts";
      state.ui.selectedMoveOutId = task.sourceCaseId;
    } else if (task.sourceRenewalId) {
      state.ui.module = "renewals";
      state.ui.selectedRenewalId = task.sourceRenewalId;
    } else {
      state.ui.module = "tasks";
    }
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsToggleTask = function (id) {
    const state = loadState();
    const task = state.tasks.find(item => item.id === id);
    if (!task) return;
    task.status = task.status === "Completed" ? "Open" : "Completed";
    task.completedAt = task.status === "Completed" ? new Date().toISOString() : "";
    addAudit(state, `${task.status === "Completed" ? "Completed" : "Reopened"} task`, { id });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsAddAccountingContact = function () {
    const state = loadState();
    const propertyName = getImportControlValue("atlas-cs-accounting-property") || "all";
    const name = getImportControlValue("atlas-cs-accounting-name");
    const email = getImportControlValue("atlas-cs-accounting-email").toLowerCase();
    const role = getImportControlValue("atlas-cs-accounting-role");
    if (!name || !email || !email.includes("@")) {
      alert("Enter a real accounting contact name and email address.");
      return;
    }
    state.accountingContacts.push({
      id: makeId("acct", [propertyName, email]),
      propertyName,
      name,
      email,
      role,
      createdAt: new Date().toISOString()
    });
    addAudit(state, "Added accounting contact", { propertyName, email });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsDeleteAccountingContact = function (id) {
    const state = loadState();
    state.accountingContacts = state.accountingContacts.filter(contact => contact.id !== id);
    addAudit(state, "Removed accounting contact", { id });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsAddChargebackCatalogItem = function () {
    const state = loadState();
    const itemName = getImportControlValue("atlas-cs-charge-item");
    if (!itemName) {
      alert("Enter a chargeback item.");
      return;
    }
    const item = normalizeChargebackCatalogItem({
      category: getImportControlValue("atlas-cs-charge-category") || "General",
      item: itemName,
      description: itemName,
      portfolioCost: numberValue(getImportControlValue("atlas-cs-charge-cost")),
      usefulLifeMonths: whole(getImportControlValue("atlas-cs-charge-life")),
      chargeType: getImportControlValue("atlas-cs-charge-type") || "Custom Charge",
      effectiveDate: TODAY_ISO,
      updatedBy: "Admin"
    });
    state.chargebackCatalog = mergeConfigById(state.chargebackCatalog, [item], normalizeChargebackCatalogItem);
    addAudit(state, "Added chargeback catalog item", { item: item.item, category: item.category });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsAddVendorProfile = function () {
    const state = loadState();
    const name = getImportControlValue("atlas-cs-vendor-name");
    if (!name) {
      alert("Enter a vendor name.");
      return;
    }
    const selectedSkills = Array.from(document.querySelectorAll('input[name="atlas-cs-vendor-skill"]:checked')).map(input => input.value);
    const profile = normalizeVendorProfile({
      name,
      entrataVendorCode: getImportControlValue("atlas-cs-vendor-code"),
      complianceStatus: getImportControlValue("atlas-cs-vendor-compliance"),
      qualityScore: whole(getImportControlValue("atlas-cs-vendor-quality")),
      reliabilityScore: whole(getImportControlValue("atlas-cs-vendor-reliability")),
      costScore: whole(getImportControlValue("atlas-cs-vendor-cost-score")),
      complianceScore: normalizeKey(getImportControlValue("atlas-cs-vendor-compliance")) === "compliant" ? 100 : 40,
      propertiesServed: state.ui.propertyId === "all" ? [] : [state.ui.propertyId],
      skills: selectedSkills,
      createdAt: new Date().toISOString()
    });
    state.vendorProfiles = mergeConfigById(state.vendorProfiles, [profile], normalizeVendorProfile);
    addAudit(state, "Added vendor profile", { vendor: profile.name, entrataVendorCode: profile.entrataVendorCode });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsSelectVendor = function (id) {
    const state = loadState();
    state.ui.selectedVendorId = cleanString(id);
    state.ui.module = "vendors";
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsAddVendorSkill = function () {
    const state = loadState();
    const skill = getImportControlValue("atlas-cs-vendor-skill-new");
    if (!skill) return;
    state.vendorSkillLibrary = uniqueStrings([...state.vendorSkillLibrary, skill]);
    addAudit(state, "Added vendor skill", { skill });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsAddComplianceRule = function () {
    const state = loadState();
    const stateCode = getImportControlValue("atlas-cs-compliance-state").toUpperCase();
    if (stateCode.length !== 2) {
      alert("Enter a two-letter state code.");
      return;
    }
    const rule = normalizeStateComplianceRule({
      state: stateCode,
      depositAccountingDeadlineDays: whole(getImportControlValue("atlas-cs-compliance-deadline")),
      disputeWindowDays: whole(getImportControlValue("atlas-cs-compliance-dispute-window")),
      dayRule: getImportControlValue("atlas-cs-compliance-day-rule"),
      calculationMethod: getImportControlValue("atlas-cs-compliance-method"),
      version: getImportControlValue("atlas-cs-compliance-version") || "v1",
      reviewedBy: getImportControlValue("atlas-cs-compliance-reviewed-by"),
      requiredStatutoryWording: getImportControlValue("atlas-cs-compliance-wording"),
      mailingRequirements: getImportControlValue("atlas-cs-compliance-delivery"),
      electronicDeliveryRules: getImportControlValue("atlas-cs-compliance-delivery"),
      certifiedMailRequirement: getImportControlValue("atlas-cs-compliance-delivery"),
      forwardingAddressRules: getImportControlValue("atlas-cs-compliance-delivery"),
      documentationRequirements: getImportControlValue("atlas-cs-compliance-delivery"),
      effectiveDate: TODAY_ISO,
      lastReviewedDate: TODAY_ISO,
      active: true
    });
    state.stateComplianceRules = mergeConfigById(state.stateComplianceRules, [rule], normalizeStateComplianceRule);
    addAudit(state, "Saved state compliance rule", { state: rule.state, version: rule.version });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsSelectDispute = function (id) {
    const state = loadState();
    state.ui.selectedDisputeId = cleanString(id);
    state.ui.module = "disputes";
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsUpdateDisputeField = function (id, field, value) {
    const state = loadState();
    const dispute = findDispute(state, id);
    if (!dispute || !["notes", "status"].includes(field)) return;
    dispute[field] = field === "status" && DISPUTE_STATUSES.includes(value) ? value : cleanString(value);
    const morf = findMorf(state, dispute.morfId);
    if (morf && field === "status") {
      morf.disputeStatus = dispute.status;
      if (ARCHIVE_STATUS_OPTIONS.includes(dispute.status)) morf.archiveStatus = dispute.status;
      pushMorfAudit(morf, `Dispute status changed to ${dispute.status}.`, { disputeId: dispute.id });
    }
    pushDisputeAudit(dispute, `Updated dispute ${field}.`);
    addAudit(state, "Updated dispute", { disputeId: id, field });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsAddDisputeVersion = function (id) {
    const state = loadState();
    const dispute = findDispute(state, id);
    if (!dispute) return;
    const adjustment = numberValue(prompt("Adjustment amount for the revised statement."));
    const reason = cleanString(prompt("Reason for the revision."));
    if (!reason) {
      alert("A reason is required for statement revisions.");
      return;
    }
    const versionNumber = asArray(dispute.versions).length + 1;
    dispute.versions.push({
      at: new Date().toISOString(),
      label: `Version ${versionNumber}`,
      originalAmount: dispute.currentAmount,
      adjustment,
      reason,
      user: "Central Services",
      residentResentAt: TODAY_ISO
    });
    dispute.currentAmount = Math.max(0, numberValue(dispute.currentAmount) + adjustment);
    dispute.statementVersion = `Version ${versionNumber}`;
    dispute.status = "In Dispute Review";
    dispute.resentAt = TODAY_ISO;
    const morf = findMorf(state, dispute.morfId);
    if (morf) {
      morf.disputeStatus = "In Dispute Review";
      morf.archiveStatus = "In Dispute Review";
      pushMorfAudit(morf, "Dispute moved to review after statement revision.", { disputeId: dispute.id, versionNumber });
    }
    pushDisputeAudit(dispute, "Added statement revision.", { versionNumber, adjustment, reason });
    addAudit(state, "Added dispute statement version", { disputeId: id, versionNumber });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsCloseDispute = function (id) {
    const state = loadState();
    const dispute = findDispute(state, id);
    if (!dispute) return;
    const reason = cleanString(prompt("Reason for closing this dispute."));
    if (!reason) {
      alert("A close reason is required.");
      return;
    }
    dispute.status = "Dispute Closed";
    dispute.closedAt = new Date().toISOString();
    pushDisputeAudit(dispute, "Dispute closed.", { reason });
    const morf = findMorf(state, dispute.morfId);
    if (morf) {
      morf.archiveStatus = "Dispute Closed";
      morf.disputeStatus = "Dispute Closed";
      pushMorfAudit(morf, "Dispute closed on archived MORF.", { disputeId: dispute.id, reason });
    }
    addAudit(state, "Closed dispute", { disputeId: id, reason });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsUpdateArchivedMorfStatus = function (morfId, status) {
    const state = loadState();
    const morf = findMorf(state, morfId);
    if (!morf || !ARCHIVE_STATUS_OPTIONS.includes(status)) return;
    const oldStatus = morf.archiveStatus || "Sent to Accounting / Open";
    morf.archiveStatus = status;
    morf.disputeStatus = status.includes("Dispute") ? status : morf.disputeStatus;
    if (status === "MORF Closed") {
      morf.status = "MORF Closed";
      morf.closedAt = new Date().toISOString();
      morf.lifecycleTimestamps = asObject(morf.lifecycleTimestamps);
      morf.lifecycleTimestamps.morfClosed = morf.lifecycleTimestamps.morfClosed || morf.closedAt;
      const caseRecord = getMorfRelatedCase(state, morf);
      if (caseRecord) setCaseWorkflowStatus(caseRecord, "MORF Closed", "Archived MORF status changed to MORF Closed.");
    }
    pushMorfAudit(morf, `Archive status changed from ${oldStatus} to ${status}.`, { oldStatus, status });
    addAudit(state, "Updated archived MORF status", { morfId, oldStatus, status });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsUpdateWorkflowSetting = function (field, value) {
    const state = loadState();
    const allowed = new Set(["morfInternalBusinessDays", "defaultMarketZipMultiplier", "lockReviewBusinessDays", "mailingBufferBusinessDays", "companyHolidays", "inspectionEligibleRoleSignals"]);
    if (!allowed.has(field)) return;
    state.workflowSettings[field] = field === "defaultMarketZipMultiplier"
      ? Number(value) || 1
      : field === "companyHolidays"
        ? uniqueStrings(cleanString(value).split(",").map(normalizeDate).filter(Boolean))
        : field === "inspectionEligibleRoleSignals"
          ? uniqueStrings(cleanString(value).split(",").map(item => cleanString(item)).filter(Boolean))
        : whole(value);
    addAudit(state, "Updated workflow setting", { field, value: state.workflowSettings[field] });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsAddRoomLibraryItem = function () {
    const state = loadState();
    const room = getImportControlValue("atlas-cs-room-new");
    if (!room) return;
    state.roomLibrary = uniqueStrings([...state.roomLibrary, room]);
    addAudit(state, "Added inspection room", { room });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsAddComponentLibraryItem = function () {
    const state = loadState();
    const component = getImportControlValue("atlas-cs-component-new");
    if (!component) return;
    state.componentLibrary = uniqueStrings([...state.componentLibrary, component]);
    addAudit(state, "Added inspection component", { component });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsExportData = function () {
    const state = loadState();
    const exportPayload = {
      exportedAt: new Date().toISOString(),
      scope: {
        propertyId: state.ui.propertyId,
        month: MONTH_LABELS[selectedMonthIdx(state)],
        year: selectedYear(state)
      },
      centralServicesEmployees: getCentralServicesEmployees(),
      propertyMonthSummaries: getPropertyMonthSummaries(state),
      centralServicesState: state
    };
    downloadJson("atlas-central-services-export.json", exportPayload);
  };
})();
