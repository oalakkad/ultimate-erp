import { describe, expect, it } from 'vitest';
import { type Command, filterCommands, normalize } from './commands.js';

const command = (id: string, label: string, extra: Partial<Command> = {}): Command => ({
  id,
  group: 'pages',
  label,
  run: () => undefined,
  ...extra,
});

const commands = [
  command('dashboard', 'Dashboard', { keywords: ['لوحة المعلومات', 'home'] }),
  command('members', 'Members'),
  command('invite', 'Invite a colleague', { group: 'actions' }),
  command('sara', 'Sara Al-Mutairi', { group: 'members', hint: 'sara@firm.example' }),
  command('admin', 'إدارة الأعضاء'),
];

const ids = (list: Command[]) => list.map((c) => c.id);

describe('filterCommands', () => {
  it('returns everything for an empty query', () => {
    expect(ids(filterCommands(commands, '  '))).toEqual(ids(commands));
  });

  it('matches every word, in any order, case-insensitively', () => {
    expect(ids(filterCommands(commands, 'COLLEAGUE invite'))).toEqual(['invite']);
  });

  it('searches hints and keywords too', () => {
    expect(ids(filterCommands(commands, 'firm.example'))).toEqual(['sara']);
    expect(ids(filterCommands(commands, 'لوحة'))).toEqual(['dashboard']);
  });

  it('puts labels that start with the query first', () => {
    expect(ids(filterCommands(commands, 'm'))).toEqual(['members', 'dashboard', 'sara']);
  });

  it('finds Arabic words whatever the alef or diacritics', () => {
    expect(ids(filterCommands(commands, 'ادارة'))).toEqual(['admin']);
    expect(normalize('مُدِيرَة')).toBe('مديره');
  });
});
