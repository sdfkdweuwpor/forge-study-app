/**
 * A complete example plan: shown in the schema reference, embedded in the prompt for Claude and
 * loaded by "Try the example". It is real WGU course data and must always pass `parsePlan` with no
 * warnings (a test enforces it).
 */
export const EXAMPLE_JSON = `{
  "forgePlan": 1,
  "goal": {
    "name": "B.S. Computer Science — WGU",
    "icon": "🎓",
    "targetDate": "2027-03-31",
    "term": { "start": "2026-10-01", "end": "2027-03-31" },
    "availability": {
      "hoursPerWeekday": { "mon": 2, "tue": 2, "wed": 2, "thu": 2, "fri": 1, "sat": 3, "sun": 0 },
      "daysOff": [{ "from": "2026-12-24", "to": "2026-12-26" }]
    }
  },
  "courses": [
    {
      "code": "C182",
      "name": "Introduction to IT",
      "cus": 4,
      "type": "OA",
      "estimatedHours": 40,
      "units": [
        { "title": "Hardware and operating systems", "estimatedHours": 6 },
        { "title": "Networks and the internet", "estimatedHours": 7 },
        { "title": "Programming and scripting concepts", "estimatedMinutes": 360 },
        { "title": "Cloud and virtualization", "estimatedHours": 7 },
        { "title": "Databases", "estimatedHours": 7 },
        { "title": "Security and ethics", "estimatedHours": 7 }
      ],
      "assessments": [{ "title": "Objective assessment", "kind": "exam" }]
    },
    {
      "code": "D278",
      "name": "Scripting and Programming Foundations",
      "cus": 4,
      "type": "OA",
      "estimatedHours": 45,
      "prerequisites": ["C182"],
      "targetDate": "2026-12-15"
    },
    {
      "code": "C779",
      "name": "Web Development Foundations",
      "cus": 3,
      "type": "PA",
      "estimatedHours": 30,
      "prerequisites": ["C182"],
      "assessments": [{ "title": "Web page project", "kind": "project", "date": "2026-11-20" }]
    }
  ]
}
`
