type InstructionsModalProps = {
  open: boolean;
  onClose: () => void;
};

export function InstructionsModal({ open, onClose }: InstructionsModalProps) {
  if (!open) return null;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Instructions">
      <div className="instructions-modal">
        <div className="instructions-top">
          <h2>Instructions</h2>
          <button className="modal-close" type="button" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="instructions-body">
          <section>
            <h3>Use the three editors</h3>
            <p>
              The left editor is for tasks, the middle editor is for websites and subscriptions,
              and the right editor is for today&apos;s timetable.
            </p>
            <p>Click an empty line and type normally to keep free text notes.</p>
          </section>

          <section>
            <h3>Create structured items</h3>
            <p>
              Start an item with <code>&lt;</code>, separate fields with <code>;</code>, and finish
              with <code>&gt;</code>. The item type comes from the section you are typing under.
            </p>
            <pre>{`<Name; date or time; tag
optional note>`}</pre>
            <p>
              For subscriptions, type under the Subscriptions section and use{" "}
              <code>&lt;name; rate; tag&gt;</code>. The rate can be written like{" "}
              <code>$12/month</code>, <code>$99/year</code>, or <code>$8 every 2 weeks</code>.
            </p>
          </section>

          <section>
            <h3>Examples</h3>
            <pre>{`Task:
<Pay rent; tomorrow 9:00am; Home
Apartment payment>

Website:
<AWS; username, touch_id; Coding
Requires SSO>

Subscription:
<Netflix; $15.49/month; Entertainment
Family streaming plan>

Timetable:
<Gym; 6:00pm; Health>`}</pre>
          </section>

          <section>
            <h3>Edit and organize</h3>
            <p>Saved rows format automatically. Click a saved row to reopen its raw macro text.</p>
            <p>
              Tags are created automatically when needed. Open Settings for Tags, Routine, Archive,
              and Profile editors.
            </p>
          </section>

          <section>
            <h3>Type special characters</h3>
            <p>
              Use a backslash when you want a literal delimiter: <code>\&lt;</code>,{" "}
              <code>\&gt;</code>, <code>\;</code>, <code>\,</code>, or <code>\\</code>.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
