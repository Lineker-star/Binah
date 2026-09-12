/**
 * Letter grade for a certificate, derived from the final assessment's
 * score percentage. Standard 9-band scale; C's floor (70%) matches the
 * `passed` threshold used everywhere else in this app (assessments.passed,
 * quiz/Continuous Assessment/Exam) — below that is F, same cutoff, no
 * separate "almost passed" band invented just for certificates.
 */
const GRADE_BANDS: ReadonlyArray<{ min: number; grade: string }> = [
  { min: 97, grade: 'A+' },
  { min: 93, grade: 'A' },
  { min: 90, grade: 'A-' },
  { min: 87, grade: 'B+' },
  { min: 83, grade: 'B' },
  { min: 80, grade: 'B-' },
  { min: 75, grade: 'C+' },
  { min: 70, grade: 'C' },
];

export function deriveGrade(scorePct: number): string {
  for (const band of GRADE_BANDS) {
    if (scorePct >= band.min) return band.grade;
  }
  return 'F';
}
