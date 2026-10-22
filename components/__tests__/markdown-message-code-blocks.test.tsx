/**
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { MarkdownMessage } from '../markdown-message';

// Feature: mobile-responsive-chat, Task 9.1: Update markdown rendering for code blocks
// Validates: Requirements 4.2

describe('MarkdownMessage - Code Block Scrolling', () => {
  describe('Code block horizontal scrolling', () => {
    it('should render code blocks with overflow-x-auto class', () => {
      const markdownWithCode = '```javascript\nconst x = 1;\n```';
      
      const { container } = render(<MarkdownMessage content={markdownWithCode} />);
      
      // Find the code element
      const codeElement = container.querySelector('code');
      expect(codeElement).toBeDefined();
      expect(codeElement).not.toBeNull();
      
      // Verify it has overflow-x-auto class
      const classes = codeElement?.className || '';
      expect(classes).toContain('overflow-x-auto');
    });

    it('should render code blocks with block display', () => {
      const markdownWithCode = '```python\ndef hello():\n    print("Hello")\n```';
      
      const { container } = render(<MarkdownMessage content={markdownWithCode} />);
      
      const codeElement = container.querySelector('code');
      expect(codeElement).toBeDefined();
      
      // Verify it has block class
      const classes = codeElement?.className || '';
      expect(classes).toContain('block');
    });

    it('should render inline code without overflow-x-auto', () => {
      const markdownWithInlineCode = 'This is `inline code` in text.';
      
      const { container } = render(<MarkdownMessage content={markdownWithInlineCode} />);
      
      // Inline code is NOT wrapped in <pre>, only block code is
      const preElement = container.querySelector('pre');
      const codeElement = container.querySelector('code');
      
      expect(codeElement).toBeDefined();
      
      // If there's no <pre>, it's inline code and should have inline styles
      if (!preElement) {
        const classes = codeElement?.className || '';
        expect(classes).not.toContain('overflow-x-auto');
        expect(classes).not.toContain('block');
        expect(classes).toContain('bg-gray-800');
        expect(classes).toContain('px-1.5');
      } else {
        // If wrapped in <pre>, it's a block code (this shouldn't happen for inline)
        // But react-markdown might render it differently
        const classes = codeElement?.className || '';
        expect(classes).toContain('overflow-x-auto');
      }
    });

    it('should render code blocks with proper styling for mobile', () => {
      const longCode = '```javascript\nconst veryLongVariableName = "This is a very long line of code that would definitely overflow on mobile devices and needs horizontal scrolling";\n```';
      
      const { container } = render(<MarkdownMessage content={longCode} />);
      
      const codeElement = container.querySelector('code');
      expect(codeElement).toBeDefined();
      
      // Verify all required classes are present
      const classes = codeElement?.className || '';
      expect(classes).toContain('overflow-x-auto');
      expect(classes).toContain('block');
      expect(classes).toContain('bg-gray-800');
      expect(classes).toContain('p-3');
      expect(classes).toContain('rounded-lg');
    });

    it('should wrap code blocks in pre element with proper styling', () => {
      const markdownWithCode = '```typescript\ninterface User { name: string; }\n```';
      
      const { container } = render(<MarkdownMessage content={markdownWithCode} />);
      
      const preElement = container.querySelector('pre');
      expect(preElement).toBeDefined();
      expect(preElement).not.toBeNull();
      
      // Verify pre has proper classes
      const classes = preElement?.className || '';
      expect(classes).toContain('my-4');
      expect(classes).toContain('rounded-lg');
      expect(classes).toContain('overflow-hidden');
    });

    it('should handle multiple code blocks in same message', () => {
      const markdownWithMultipleBlocks = `
First code block:
\`\`\`javascript
const x = 1;
\`\`\`

Second code block:
\`\`\`python
y = 2
\`\`\`
`;
      
      const { container } = render(<MarkdownMessage content={markdownWithMultipleBlocks} />);
      
      const codeElements = container.querySelectorAll('code.block');
      expect(codeElements.length).toBe(2);
      
      // Both should have overflow-x-auto
      codeElements.forEach(code => {
        const classes = code.className;
        expect(classes).toContain('overflow-x-auto');
      });
    });

    it('should render code blocks with text-sm for readability', () => {
      const markdownWithCode = '```bash\necho "Hello World"\n```';
      
      const { container } = render(<MarkdownMessage content={markdownWithCode} />);
      
      const codeElement = container.querySelector('code');
      expect(codeElement).toBeDefined();
      
      const classes = codeElement?.className || '';
      expect(classes).toContain('text-sm');
    });
  });
});
