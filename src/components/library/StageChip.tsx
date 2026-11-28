import React from 'react';
import { Pill } from '../ui';
import { MifStage, STAGE_LABEL, stageTone } from '../../theme/library';

/** Design library: tracker stage as a Pill (Sanctioned / Docs pending / Disbursal initiated / Credited). Never truncated. */
export function StageChip({ stage }: { stage: MifStage }) {
  return <Pill label={STAGE_LABEL[stage]} tone={stageTone[stage]} />;
}
