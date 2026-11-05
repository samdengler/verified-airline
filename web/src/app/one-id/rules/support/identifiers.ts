// The model's identifier constants, read from model/one-id/model.json.  An
// identifier the model no longer has stops the app as it loads.
import model from '../../../../../../model/one-id/model.json';

type Kind = keyof typeof model.identifiers;

function value(kind: Kind, name: string): string {
  const found = model.identifiers[kind].find((i) => i.name === name);
  if (!found) throw new Error(`model/one-id/model.json has no ${kind} entry named ${name}`);
  return found.value;
}

export const photoidDocType = value('docTypes', 'photoidDocType');
export const boardingPassDocType = value('docTypes', 'boardingPassDocType');
export const baseNameSpace = value('nameSpaces', 'baseNameSpace');
export const photoidNameSpace = value('nameSpaces', 'photoidNameSpace');
export const dataGroupsNameSpace = value('nameSpaces', 'dataGroupsNameSpace');
export const bcbpNameSpace = value('nameSpaces', 'bcbpNameSpace');
export const familyNameId = value('dataElements', 'familyNameId');
export const givenNameId = value('dataElements', 'givenNameId');
export const portraitId = value('dataElements', 'portraitId');
export const enrolmentPortraitId = value('dataElements', 'enrolmentPortraitId');
export const dg2Id = value('dataElements', 'dg2Id');
export const bcbpStringId = value('dataElements', 'bcbpStringId');
