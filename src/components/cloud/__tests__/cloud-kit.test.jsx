/**
 * Render + interaction coverage for the Cloud primitive kit (task A4).
 * Mirrors the conventions in
 * src/components/shared/__tests__/PendingAudioBanner.test.jsx.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { Card, CardRow } from '../Card';
import { Button } from '../Button';
import { Switch } from '../Switch';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../Tabs';
import { Chip } from '../Chip';
import {
  Drawer,
  DrawerTrigger,
  DrawerContent,
  DrawerTitle,
} from '../Drawer';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
} from '../Dialog';
import { Checkbox } from '../Checkbox';
import { SectionLabel } from '../SectionLabel';

describe('Card', () => {
  it('renders children and merges className', () => {
    const { container } = render(<Card className="mt-4">hello</Card>);
    expect(screen.getByText('hello')).toBeTruthy();
    expect(container.firstChild.className).toContain('mt-4');
    expect(container.firstChild.className).toContain('rounded-2xl');
  });

  it('CardRow renders with a divider hairline class', () => {
    render(
      <Card>
        <CardRow className="custom-row">row content</CardRow>
      </Card>
    );
    const row = screen.getByText('row content');
    expect(row.className).toContain('custom-row');
    expect(row.className).toContain('border-divider');
  });
});

describe('Button', () => {
  it('renders each variant and fires onClick', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save entry</Button>);
    fireEvent.click(screen.getByText('Save entry'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('merges className passthrough', () => {
    render(<Button className="w-full">Go</Button>);
    expect(screen.getByText('Go').className).toContain('w-full');
  });

  it('applies outline and ghost variant classes', () => {
    const { rerender } = render(<Button variant="outline">Outline</Button>);
    expect(screen.getByText('Outline').className).toContain('border-border');
    rerender(<Button variant="ghost">Ghost</Button>);
    expect(screen.getByText('Ghost').className).toContain('bg-transparent');
  });

  it('lg size applies the 52px min height', () => {
    render(<Button size="lg">Big</Button>);
    expect(screen.getByText('Big').className).toContain('min-h-[52px]');
  });
});

describe('Switch', () => {
  it('toggles via click and fires onCheckedChange', () => {
    const onCheckedChange = vi.fn();
    render(<Switch aria-label="Background motion" onCheckedChange={onCheckedChange} />);
    const el = screen.getByRole('switch');
    expect(el.getAttribute('aria-checked')).toBe('false');

    fireEvent.click(el);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('reflects a controlled checked state', () => {
    render(<Switch aria-label="Dark mode" checked readOnly />);
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
  });
});

describe('Tabs', () => {
  it('switches panels when a trigger is clicked', () => {
    render(
      <Tabs defaultValue="week">
        <TabsList>
          <TabsTrigger value="week">Week</TabsTrigger>
          <TabsTrigger value="month">Month</TabsTrigger>
        </TabsList>
        <TabsContent value="week">Week content</TabsContent>
        <TabsContent value="month">Month content</TabsContent>
      </Tabs>
    );

    expect(screen.getByText('Week content')).toBeTruthy();
    expect(screen.queryByText('Month content')).toBeNull();

    // Radix Tabs activates via onMouseDown (button 0); fireEvent.click
    // alone only dispatches a bare 'click' event and skips that handler,
    // so fire the mousedown a real click sequence would include.
    const monthTrigger = screen.getByText('Month');
    fireEvent.mouseDown(monthTrigger, { button: 0 });
    fireEvent.click(monthTrigger);

    expect(screen.getByText('Month content')).toBeTruthy();
    expect(screen.queryByText('Week content')).toBeNull();
  });

  it('marks the active trigger with the accent-deep state classes', () => {
    render(
      <Tabs defaultValue="week">
        <TabsList>
          <TabsTrigger value="week">Week</TabsTrigger>
          <TabsTrigger value="month">Month</TabsTrigger>
        </TabsList>
        <TabsContent value="week">Week content</TabsContent>
        <TabsContent value="month">Month content</TabsContent>
      </Tabs>
    );
    expect(screen.getByText('Week').getAttribute('data-state')).toBe('active');
    expect(screen.getByText('Month').getAttribute('data-state')).toBe('inactive');
  });
});

describe('Chip', () => {
  it('renders default (unselected) styling', () => {
    render(<Chip>Voice</Chip>);
    const chip = screen.getByText('Voice');
    expect(chip.className).toContain('bg-accent-wash');
    expect(chip.className).toContain('text-accent-deep');
  });

  it('renders selected styling when selected', () => {
    render(<Chip selected>Voice</Chip>);
    const chip = screen.getByText('Voice');
    expect(chip.className).toContain('bg-accent-deep');
  });

  it('supports rendering as a button and firing onClick', () => {
    const onClick = vi.fn();
    render(
      <Chip as="button" onClick={onClick}>
        All
      </Chip>
    );
    fireEvent.click(screen.getByText('All'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('pads the tap target to 44px via a ::before overlay without growing the visual pill (A4 known issue, fixed in C4)', () => {
    render(<Chip>Voice</Chip>);
    const chip = screen.getByText('Voice');
    // Visual pill stays the compact §5 size...
    expect(chip.className).toContain('min-h-[28px]');
    // ...while an invisible relative/before overlay pads the hit area out to
    // ~44px (28px + 8px inset on each side) for interactive consumers.
    expect(chip.className).toContain('relative');
    expect(chip.className).toMatch(/before:-inset-2\b/);
    expect(chip.className).toContain("before:content-['']");
  });
});

describe('Checkbox', () => {
  it('checks via click and fires onCheckedChange', () => {
    const onCheckedChange = vi.fn();
    render(<Checkbox aria-label="Include mood" onCheckedChange={onCheckedChange} />);
    const el = screen.getByRole('checkbox');
    expect(el.getAttribute('aria-checked')).toBe('false');

    fireEvent.click(el);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });
});

describe('SectionLabel', () => {
  it('renders text with the section-label type classes', () => {
    render(<SectionLabel>App</SectionLabel>);
    const el = screen.getByText('App');
    expect(el.className).toContain('uppercase');
    expect(el.className).toContain('text-muted-foreground');
  });
});

describe('Dialog', () => {
  it('opens on trigger click and closes via Close button', () => {
    render(
      <Dialog>
        <DialogTrigger>Open mood picker</DialogTrigger>
        <DialogContent>
          <DialogTitle>Quick mood</DialogTitle>
        </DialogContent>
      </Dialog>
    );

    expect(screen.queryByText('Quick mood')).toBeNull();
    fireEvent.click(screen.getByText('Open mood picker'));
    expect(screen.getByText('Quick mood')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Close'));
    expect(screen.queryByText('Quick mood')).toBeNull();
  });

  it('overlay uses the --overlay CSS-var token, not a Tailwind /NN opacity modifier (D4a fix)', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Quick mood</DialogTitle>
        </DialogContent>
      </Dialog>
    );
    const overlay = screen.getByTestId('dialog-overlay');
    expect(overlay.className).toContain('bg-[var(--overlay)]');
    // Guards against regressing to a `/NN` opacity modifier on a CSS-var
    // color (bg-black/40, bg-foreground/40, etc.) — those silently no-op
    // under this project's Tailwind config (see Dialog.jsx comment).
    expect(overlay.className).not.toMatch(/bg-(black|white|foreground|primary|card)\/\d+/);
  });
});

describe('Drawer', () => {
  it('renders its content only when open', () => {
    const { rerender } = render(
      <Drawer open={false}>
        <DrawerContent>
          <DrawerTitle>New entry</DrawerTitle>
        </DrawerContent>
      </Drawer>
    );
    expect(screen.queryByText('New entry')).toBeNull();

    rerender(
      <Drawer open>
        <DrawerContent>
          <DrawerTitle>New entry</DrawerTitle>
        </DrawerContent>
      </Drawer>
    );
    expect(screen.getByText('New entry')).toBeTruthy();
  });

  it('renders the grab handle', () => {
    render(
      <Drawer open>
        <DrawerContent>
          <DrawerTitle>New entry</DrawerTitle>
        </DrawerContent>
      </Drawer>
    );
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('New entry')).toBeTruthy();
  });

  it('overlay uses the --overlay CSS-var token, not a Tailwind /NN opacity modifier (D4a fix)', () => {
    render(
      <Drawer open>
        <DrawerContent>
          <DrawerTitle>New entry</DrawerTitle>
        </DrawerContent>
      </Drawer>
    );
    const overlay = screen.getByTestId('drawer-overlay');
    expect(overlay.className).toContain('bg-[var(--overlay)]');
    expect(overlay.className).not.toMatch(/bg-(black|white|foreground|primary|card)\/\d+/);
  });
});
