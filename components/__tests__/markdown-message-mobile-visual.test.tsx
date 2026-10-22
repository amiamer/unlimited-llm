/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { MarkdownMessage } from '../markdown-message';

// Feature: mobile-responsive-chat, Task 9.1: Update markdown rendering for code blocks
// Validates: Requirements 4.2
// Visual verification test for mobile viewport

describe('MarkdownMessage - Mobile Code Block Scrolling', () => {
  beforeEach(() => {
    // Set viewport to mobile size
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 375,
    });
  });

  it('should enable horizontal scrolling for long code on mobile viewport', () => {
    // Very long line that would overflow on mobile (375px width)
    const longCodeLine = 'const veryLongVariableNameThatWouldDefinitelyOverflowOnMobileDevicesAndNeedsHorizontalScrolling = "This is a very long string value";';
    const markdownWithLongCode = `\`\`\`javascript\n${longCodeLine}\n\`\`\``;
    
    const { container } = render(<MarkdownMessage content={markdownWithLongCode} />);
    
    const codeElement = container.querySelector('code');
    expect(codeElement).toBeDefined();
    expect(codeElement).not.toBeNull();
    
    // Verify overflow-x-auto is present for horizontal scrolling
    const classes = codeElement?.className || '';
    expect(classes).toContain('overflow-x-auto');
    
    // Verify the code content is present
    expect(codeElement?.textContent).toContain(longCodeLine);
  });

  it('should handle multiple long lines in code block on mobile', () => {
    const longCode = `\`\`\`typescript
interface VeryLongInterfaceNameForDemonstrationPurposes {
  veryLongPropertyNameThatExceedsMobileWidth: string;
  anotherVeryLongPropertyNameForTestingHorizontalScroll: number;
}
\`\`\``;
    
    const { container } = render(<MarkdownMessage content={longCode} />);
    
    const codeElement = container.querySelector('code');
    expect(codeElement).toBeDefined();
    
    // Verify scrolling is enabled
    const classes = codeElement?.className || '';
    expect(classes).toContain('overflow-x-auto');
    expect(classes).toContain('block');
  });

  it('should maintain readability with text-sm on mobile', () => {
    const markdownWithCode = '```python\ndef calculate_something():\n    return 42\n```';
    
    const { container } = render(<MarkdownMessage content={markdownWithCode} />);
    
    const codeElement = container.querySelector('code');
    expect(codeElement).toBeDefined();
    
    // Verify text size is appropriate for mobile
    const classes = codeElement?.className || '';
    expect(classes).toContain('text-sm');
  });

  it('should have proper padding for touch-friendly scrolling', () => {
    const markdownWithCode = '```bash\necho "Testing padding for mobile scrolling"\n```';
    
    const { container } = render(<MarkdownMessage content={markdownWithCode} />);
    
    const codeElement = container.querySelector('code');
    expect(codeElement).toBeDefined();
    
    // Verify padding is present (p-3 = 0.75rem = 12px)
    const classes = codeElement?.className || '';
    expect(classes).toContain('p-3');
  });
});
