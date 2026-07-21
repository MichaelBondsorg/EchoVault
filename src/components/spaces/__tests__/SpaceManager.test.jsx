import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import SpaceManager from '../SpaceManager';
import {
  subscribeSpaces,
  createSpace,
  renameSpace,
  archiveSpace,
  seedStarterSpaces,
  reassignEntriesSpace,
} from '../../../services/spaces/spacesService';

vi.mock('../../../config/firebase', () => ({ db: { __db: true } }));

vi.mock('../../../services/spaces/spacesService', () => ({
  subscribeSpaces: vi.fn(),
  createSpace: vi.fn().mockResolvedValue({ id: 'new-space', name: 'New' }),
  renameSpace: vi.fn().mockResolvedValue(undefined),
  archiveSpace: vi.fn().mockResolvedValue(undefined),
  seedStarterSpaces: vi.fn().mockResolvedValue(4),
  reassignEntriesSpace: vi.fn().mockResolvedValue(0),
}));

const UID = 'user-a';

const withSpaces = (spaces) => {
  subscribeSpaces.mockImplementation((_db, _uid, cb) => {
    cb(spaces);
    return () => {};
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  withSpaces([]);
});

describe('SpaceManager — starter-seed CTA gating', () => {
  it('shows the starter-seed CTA when the user has zero spaces', async () => {
    withSpaces([]);
    render(<SpaceManager uid={UID} onClose={vi.fn()} />);

    expect(await screen.findByText('Create starter spaces')).toBeTruthy();
  });

  it('does not show the starter-seed CTA once the user has any space', async () => {
    withSpaces([{ id: 'space-1', name: 'Work', state: 'active' }]);
    render(<SpaceManager uid={UID} onClose={vi.fn()} />);

    await screen.findByText('Work');
    expect(screen.queryByText('Create starter spaces')).toBeNull();
  });

  it('does not show the CTA before the first subscription callback fires (avoids a flash)', () => {
    subscribeSpaces.mockImplementation(() => () => {}); // never calls back
    render(<SpaceManager uid={UID} onClose={vi.fn()} />);

    expect(screen.queryByText('Create starter spaces')).toBeNull();
  });

  it('tapping the CTA calls seedStarterSpaces with (db, uid)', async () => {
    withSpaces([]);
    render(<SpaceManager uid={UID} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByText('Create starter spaces'));

    await waitFor(() => expect(seedStarterSpaces).toHaveBeenCalledWith({ __db: true }, UID));
  });
});

describe('SpaceManager — create + rename', () => {
  it('creates a new space via the New Space form', async () => {
    withSpaces([]);
    render(<SpaceManager uid={UID} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('New space name'), { target: { value: 'Travel' } });
    fireEvent.click(screen.getByText('New space'));

    await waitFor(() => expect(createSpace).toHaveBeenCalledWith({ __db: true }, UID, 'Travel'));
  });

  it('renames a space inline', async () => {
    withSpaces([{ id: 'space-1', name: 'Work', state: 'active' }]);
    render(<SpaceManager uid={UID} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByLabelText('Rename Work'));
    const input = screen.getByLabelText('Rename Work');
    fireEvent.change(input, { target: { value: 'Career' } });
    fireEvent.click(screen.getByLabelText('Save name'));

    await waitFor(() => expect(renameSpace).toHaveBeenCalledWith({ __db: true }, UID, 'space-1', 'Career'));
  });
});

describe('SpaceManager — archive flow (3-option sheet)', () => {
  it('Move entries: reassigns to the chosen space THEN archives, in that order', async () => {
    withSpaces([
      { id: 'space-1', name: 'Work', state: 'active' },
      { id: 'space-2', name: 'Personal', state: 'active' },
    ]);
    render(<SpaceManager uid={UID} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByLabelText('Archive Work'));
    expect(screen.getByText(/Archive/)).toBeTruthy();

    fireEvent.click(screen.getByText('Move entries to another space'));
    const archiveSheet = screen.getByRole('dialog', { name: /Archive/i });
    // Only the other active space should be offered, not the one being archived.
    expect(within(archiveSheet).queryByRole('button', { name: 'Work' })).toBeNull();
    fireEvent.click(within(archiveSheet).getByText('Personal'));

    await waitFor(() => expect(archiveSpace).toHaveBeenCalled());

    expect(reassignEntriesSpace).toHaveBeenCalledWith({ __db: true }, UID, 'space-1', 'space-2');
    expect(archiveSpace).toHaveBeenCalledWith({ __db: true }, UID, 'space-1');
    expect(reassignEntriesSpace.mock.invocationCallOrder[0]).toBeLessThan(
      archiveSpace.mock.invocationCallOrder[0]
    );
  });

  it('Keep unscoped: reassigns to null THEN archives', async () => {
    withSpaces([{ id: 'space-1', name: 'Work', state: 'active' }]);
    render(<SpaceManager uid={UID} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByLabelText('Archive Work'));
    fireEvent.click(screen.getByText('Keep entries unscoped'));

    await waitFor(() => expect(archiveSpace).toHaveBeenCalled());

    expect(reassignEntriesSpace).toHaveBeenCalledWith({ __db: true }, UID, 'space-1', null);
    expect(archiveSpace).toHaveBeenCalledWith({ __db: true }, UID, 'space-1');
    expect(reassignEntriesSpace.mock.invocationCallOrder[0]).toBeLessThan(
      archiveSpace.mock.invocationCallOrder[0]
    );
  });

  it('Cancel is a pure no-op: closes the sheet and calls neither reassignEntriesSpace nor archiveSpace', async () => {
    withSpaces([{ id: 'space-1', name: 'Work', state: 'active' }]);
    render(<SpaceManager uid={UID} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByLabelText('Archive Work'));
    fireEvent.click(screen.getByText('Cancel'));

    expect(screen.queryByText(/^Archive/)).toBeNull();
    expect(reassignEntriesSpace).not.toHaveBeenCalled();
    expect(archiveSpace).not.toHaveBeenCalled();
  });
});
