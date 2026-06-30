export function FieldTip({ tip }: { tip: string }) {
  return (
    <span className="field-tip">
      <span className="field-tip-icon" aria-label="Field help">?</span>
      <span className="field-tip-popover" role="tooltip">{tip}</span>
    </span>
  );
}
