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
              Start an item with <code>&lt;</code>; the editor adds <code>&gt;</code>{" "}
              automatically. Type inside the brackets, separate fields with <code>;</code>, then
              press Enter with the cursor immediately after <code>&gt;</code> to save the item. The
              item type comes from the section you are typing under.
            </p>
            <pre>{`<Name; date or time; tag
optional note>`}</pre>
            <p>
              For subscriptions, type under the Subscriptions section and use{" "}
              <code>name; amount, currency, interval count, interval unit; tag</code> inside the
              brackets.
              The rate must have four comma-separated values, such as{" "}
              <code>8, USD, 4, weeks</code> or <code>8, $, 1, month</code>.
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
<Netflix; 15.49, USD, 1, month; Entertainment
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
            <h3>Encryption and ChatGPT</h3>
            <p>
              Your workspace is encrypted before it is saved to the server. Copy your recovery key
              from Account &gt; Encryption and store it privately. If the key is lost, the workspace
              cannot be recovered.
            </p>
            <p>
              ChatGPT tools need a separate one-month access grant from Account &gt; Encryption. You can
              revoke that grant at any time.
            </p>
          </section>

          <section>
            <h3>Type special characters</h3>
            <p>
              Use a backslash when you want a literal delimiter: <code>\&lt;</code>,{" "}
              <code>\&gt;</code>, <code>\;</code>, <code>\,</code>, or <code>\\</code>.
            </p>
          </section>

          <section>
            <h3>Support</h3>
            <p>
              If an error appears or something does not save correctly, email{" "}
              <a href="mailto:neerkuchlous+efficienthypothesis@gmail.com">
                neerkuchlous+efficienthypothesis@gmail.com
              </a>{" "}
              for help.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
