type ConfidenceBadgeProps = Readonly<{
  confidence: number;
}>;

function getConfidenceTone(confidence: number): string {
  if (confidence >= 80) {
    return 'analysis-confidence-badge analysis-confidence-badge-high';
  }

  if (confidence >= 60) {
    return 'analysis-confidence-badge analysis-confidence-badge-mid';
  }

  return 'analysis-confidence-badge analysis-confidence-badge-low';
}

export function ConfidenceBadge({ confidence }: ConfidenceBadgeProps) {
  return <span className={getConfidenceTone(confidence)}>{Math.round(confidence)}%</span>;
}
