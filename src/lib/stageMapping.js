/**
 * Bidirectional mapping between CRM pipeline stage and Sales Engineering stage.
 *
 * When a deal moves in the Pipeline → seStage auto-updates.
 * When a deal moves in the SE Kanban → CRM stage auto-updates.
 *
 * Won/lost/rejected/nobid → commercial_handoff (SE completed).
 * closed CRM stages do not drive SE back (one-way for closed).
 */

export const CRM_TO_SE = {
  lead:     'concept_scoping',
  prebid:   'layout_estimation',
  bid:      'technical_proposal',
  closing:  'solution_signoff',
  won:      'commercial_handoff',
  // closed stages all map to handoff (work done)
  lost:     'commercial_handoff',
  rejected: 'commercial_handoff',
  nobid:    'commercial_handoff',
}

export const SE_TO_CRM = {
  concept_scoping:    'lead',
  layout_estimation:  'prebid',
  technical_proposal: 'bid',
  solution_signoff:   'closing',
  commercial_handoff: 'won',   // Note: won triggers project creation in Pipeline
}
