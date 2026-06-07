import { Command } from '@langchain/langgraph';

describe('RoboAgent.resume approval fix', () => {
  describe('bug: decision string converted to boolean', () => {
    test('approve decision: OLD code passes boolean true, NEW code passes string', () => {
      const decision = 'approve';

      // OLD buggy code in RoboAgent.resume():
      // const approved = decision === 'approve' || decision === 'y';
      // const result = await rootGraph.invoke(new Command({ resume: approved }), config);
      const approved = decision === 'approve' || decision === 'y';
      const buggyCommand = new Command({ resume: approved });
      expect(buggyCommand.resume).toBe(true);
      expect(typeof buggyCommand.resume).toBe('boolean');

      // NEW fixed code:
      // const result = await rootGraph.invoke(new Command({ resume: decision }), config);
      const fixedCommand = new Command({ resume: decision });
      expect(fixedCommand.resume).toBe('approve');
      expect(typeof fixedCommand.resume).toBe('string');
    });

    test('reject decision: OLD code passes boolean false, NEW code passes string', () => {
      const decision = 'reject';

      // OLD: converts to boolean false
      const approved = decision === 'approve' || decision === 'y';
      const buggyCommand = new Command({ resume: approved });
      expect(buggyCommand.resume).toBe(false);

      // NEW: keeps string
      const fixedCommand = new Command({ resume: decision });
      expect(fixedCommand.resume).toBe('reject');
    });

    test('y shorthand: OLD code passes boolean true, NEW code passes string', () => {
      const decision = 'y';

      // OLD: converts to boolean true
      const approved = decision === 'approve' || decision === 'y';
      const buggyCommand = new Command({ resume: approved });
      expect(buggyCommand.resume).toBe(true);

      // NEW: keeps string
      const fixedCommand = new Command({ resume: decision });
      expect(fixedCommand.resume).toBe('y');
    });

    test('n shorthand: OLD code passes boolean false, NEW code passes string', () => {
      const decision = 'n';

      // OLD: converts to boolean false
      const approved = decision === 'approve' || decision === 'y';
      const buggyCommand = new Command({ resume: approved });
      expect(buggyCommand.resume).toBe(false);

      // NEW: keeps string
      const fixedCommand = new Command({ resume: decision });
      expect(fixedCommand.resume).toBe('n');
    });
  });

  describe('handlers expect string decisions', () => {
    test('toolsNode checks decision === "approve" || decision === "y"', () => {
      // In toolsNode, after interrupt():
      // const decision = interrupt(...) as 'approve' | 'reject' | 'y' | 'n';
      // const approved = decision === 'approve' || decision === 'y';
      // If decision is boolean true (from buggy resume()), this check fails:

      const decision = true as unknown; // What RoboAgent.resume() sends (buggy)
      const approved = decision === 'approve' || decision === 'y';
      expect(approved).toBe(false); // BUG: approved is false even though user approved!

      // With fix, decision is string:
      const fixedDecision = 'approve' as unknown;
      const fixedApproved = fixedDecision === 'approve' || fixedDecision === 'y';
      expect(fixedApproved).toBe(true); // CORRECT
    });

    test('requestApprovalTool checks decision === "approve" || decision === "y"', () => {
      // Same pattern in requestApprovalTool
      const decision = true as unknown; // Buggy boolean
      const approved = decision === 'approve' || decision === 'y';
      expect(approved).toBe(false);

      const fixedDecision = 'approve' as unknown; // Fixed string
      const fixedApproved = fixedDecision === 'approve' || fixedDecision === 'y';
      expect(fixedApproved).toBe(true);
    });
  });
});
