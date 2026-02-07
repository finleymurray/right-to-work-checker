export const DOCUMENT_LABELS = {
  // List A - Continuous right to work
  listA1: 'List A #1 \u2013 British/UK passport',
  listA2: 'List A #2 \u2013 Irish passport/passport card',
  listA3: 'List A #3 \u2013 Crown Dependency EU document',
  listA4: 'List A #4 \u2013 Passport (exempt/indefinite leave)',
  listA5: 'List A #5 \u2013 Immigration Status Document + NI',
  listA6: 'List A #6 \u2013 UK birth/adoption cert + NI',
  listA7: 'List A #7 \u2013 CI/IoM/Ireland birth/adoption cert + NI',
  listA8: 'List A #8 \u2013 Registration/naturalisation cert + NI',
  // List B Group 1 - Temporary right to work
  listB1_1: 'List B Grp 1 #1 \u2013 Endorsed passport (temp)',
  listB1_2: 'List B Grp 1 #2 \u2013 Crown Dependency limited leave',
  listB1_3: 'List B Grp 1 #3 \u2013 ISD with photograph + NI',
  // List B Group 2 - Pending applications
  listB2_1: 'List B Grp 2 #1 \u2013 EUSS app pre-30 Jun 2021 + PVN',
  listB2_2: 'List B Grp 2 #2 \u2013 CoA (non-digital) post-1 Jul 2021 + PVN',
  listB2_3: 'List B Grp 2 #3 \u2013 Crown Dependency Appendix EU + PVN',
  listB2_4: 'List B Grp 2 #4 \u2013 ARC + PVN',
  listB2_5: 'List B Grp 2 #5 \u2013 Positive Verification Notice',
  // IDSP
  idsp1: 'British passport (IDVT)',
  idsp2: 'Irish passport (IDVT)',
  idsp3: 'Irish passport card (IDVT)',
  // Online
  onlineConfirm: 'Online check confirms right to work',
  onlinePhoto: 'Photograph verified (in person/video)',
  onlineStudent: 'Student term/vacation dates obtained',
  onlineRetain: 'Profile page evidence retained',
};

export function getDocumentLabel(id) {
  return DOCUMENT_LABELS[id] || id;
}

export function getDocumentLabels(ids) {
  if (!Array.isArray(ids)) return [];
  return ids.map(id => DOCUMENT_LABELS[id] || id);
}

export const METHOD_LABELS = {
  manual: 'Manual Document Check',
  idsp: 'IDVT Check using an IDSP',
  online: 'Home Office Online Right to Work Check',
};

export const STEP2_QUESTIONS = [
  { key: 'q1', text: 'Are photographs consistent across documents and with the person presenting themselves for work?' },
  { key: 'q2', text: 'Are dates of birth correct and consistent across documents?' },
  { key: 'q3', text: 'Are expiry dates for time-limited permission to be in the UK in the future, i.e. they have not passed (if applicable)?' },
  { key: 'q4', text: 'Have you checked work restrictions to determine if the person is able to work for you and do the type of work you are offering?' },
  { key: 'q5', text: 'Have you taken all reasonable steps to check that the document is genuine, has not been tampered with and belongs to the holder?' },
  { key: 'q6', text: 'Have you checked the reasons for any different names across documents (e.g. marriage certificate, divorce decree, deed poll)?' },
];
