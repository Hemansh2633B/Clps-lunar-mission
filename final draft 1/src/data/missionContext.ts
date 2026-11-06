/**
 * Current Artemis mission context, verified against NASA's public mission pages and
 * the Oct 23, 2026 Artemis acceleration announcement. The nine south-polar candidate
 * regions in the catalogue were announced in Oct 2024 as Artemis III candidates; that
 * list is HISTORICAL. NASA has since redesignated Artemis III as a low-Earth-orbit
 * demonstration and Artemis IV as the planned first crewed lunar surface landing.
 * The 2024 region list is NOT a newly announced Artemis IV selection.
 */
export interface MissionContextEntry {
  mission: string;
  role: string;
  target: string;
  status: string;
  sourceUrl: string;
}

export const ARTEMIS_CONTEXT_AS_OF = '2026-10-23';

export const ARTEMIS_CONTEXT: MissionContextEntry[] = [
  {
    mission: 'Artemis III',
    role: 'Crewed low-Earth-orbit demonstration (rendezvous & docking with commercial lander test articles). Does not land on the Moon.',
    target: '2027',
    status: 'Planned',
    sourceUrl: 'https://www.nasa.gov/mission/artemis-iii/',
  },
  {
    mission: 'Artemis IV',
    role: 'Planned first crewed Artemis lunar surface landing — the first crewed Moon landing since Apollo 17.',
    target: 'Early 2028',
    status: 'Planned',
    sourceUrl: 'https://www.nasa.gov/mission/artemis-iv/',
  },
];

export const CANDIDATE_DATASET_LABEL = 'NASA South Polar Candidate Regions — 2024 Dataset';

export const CANDIDATE_DATASET_NOTE =
  'These nine regions were announced by NASA in October 2024 as Artemis III candidate landing regions '
  + '(each ~15 km across; NASA published regions, not precise landing points). This is a historical dataset. '
  + 'Following NASA’s October 23, 2026 announcement, Artemis III is now a 2027 low-Earth-orbit demonstration '
  + 'and Artemis IV is the planned first crewed lunar landing (early 2028). This 2024 list is not a newly '
  + 'announced Artemis IV selection; a final Artemis IV site has not been published here.';
