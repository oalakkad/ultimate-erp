import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button, IconButton } from './button.js';
import { StatusChip } from './data-display.js';
import { TextField } from './fields.js';
import { Dialog } from './overlays.js';
import { UiProvider } from './shell.js';
import { ErrorState } from './states.js';

describe('Button', () => {
  it('blocks clicks and announces busy while loading', async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('icon-only buttons are named for screen readers', () => {
    render(
      <IconButton label="Notifications">
        <svg />
      </IconButton>,
    );
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument();
  });
});

describe('TextField', () => {
  it('links the label, and the error replaces the hint for assistive technology', () => {
    const { rerender } = render(<TextField label="Work email" hint="We send a link." />);
    const input = screen.getByLabelText('Work email');
    expect(input).toHaveAccessibleDescription('We send a link.');
    expect(input).not.toHaveAttribute('aria-invalid');

    rerender(<TextField label="Work email" hint="We send a link." error="Enter an email." />);
    expect(screen.getByLabelText('Work email')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Work email')).toHaveAccessibleDescription('Enter an email.');
  });
});

describe('StatusChip', () => {
  it('always carries a text label, never colour alone', () => {
    render(<StatusChip status="warn" label="Near limit" />);
    expect(screen.getByText('Near limit')).toBeInTheDocument();
  });
});

describe('Dialog', () => {
  it('opens from its trigger, is named by its title, and closes with Escape', async () => {
    render(
      <UiProvider dir="ltr" closeLabel="Close">
        <Dialog trigger={<Button>Open</Button>} title="Approve this timesheet?" closeLabel="Close">
          <p>Body</p>
        </Dialog>
      </UiProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('dialog', { name: 'Approve this timesheet?' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('ErrorState', () => {
  it('is announced as an alert, shows the reference and offers a retry', async () => {
    const onRetry = vi.fn();
    render(
      <ErrorState
        title="Something went wrong"
        body="Try again."
        reference="Reference: abc-123"
        retryLabel="Try again"
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Reference: abc-123');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
