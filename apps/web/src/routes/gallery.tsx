import { formatDate, formatMoney, formatNumber } from '@ultimate-erp/i18n';
import {
  AppFrame,
  BarChart,
  LineChart,
  Avatar,
  Button,
  Card,
  Checkbox,
  CountBadge,
  Dialog,
  DisplayName,
  Drawer,
  EmptyState,
  ErrorState,
  IconButton,
  LoadingState,
  Logo,
  NavGroup,
  NavItem,
  PermissionDenied,
  ProfileCard,
  SearchBox,
  SelectField,
  Sidebar,
  StatCard,
  StatusChip,
  Tabs,
  TextArea,
  TextField,
  Tile,
  Tooltip,
  Topbar,
  useToast,
} from '@ultimate-erp/ui';
import {
  Bell,
  BriefcaseBusiness,
  Hourglass,
  LayoutGrid,
  LifeBuoy,
  ReceiptText,
  Settings,
  Timer,
  Wallet,
} from 'lucide-react';
import { type ReactNode } from 'react';
import { useI18n } from '../app/i18n.js';
import { LanguageSwitch, ThemeSwitch } from '../app/switches.js';

// Component gallery (docs/modules/web-ui.md). Everything on this page is clearly labelled
// example data (brief §3: prototype content allowed when isolated and identified).

/** Example data for the chart demos only (this page is a labelled fixture, brief §3). */
const EXAMPLE_FEES = [
  { billed: 42, collected: 35 },
  { billed: 38, collected: 40 },
  { billed: 51, collected: 44 },
  { billed: 47, collected: 39 },
  { billed: 56, collected: 52 },
  { billed: 61, collected: 48 },
];
const EXAMPLE_HOURS = [
  { billable: 312, internal: 96 },
  { billable: 338, internal: 88 },
  { billable: 295, internal: 120 },
  { billable: 351, internal: 84 },
  { billable: 366, internal: 79 },
  { billable: 342, internal: 92 },
  { billable: 374, internal: 70 },
  { billable: 389, internal: 66 },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-3">
      <h2 className="text-[13px] font-bold tracking-[0.06em] text-ink-3 uppercase [:root[lang=ar]_&]:tracking-normal">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function GalleryPage() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const ROLE_OPTIONS = (['owner', 'ceo', 'manager', 'employee'] as const).map((role) => ({
    value: role,
    label: t(`roles.${role}`),
  }));
  const kwd = locale === 'ar' ? 'د.ك' : 'KWD';

  return (
    <div className="mx-auto grid max-w-[1320px] gap-8 px-4 py-6">
      <header className="flex flex-wrap items-center gap-3">
        <Logo subtitle={t('ui.gallery.title')} />
        <span className="rounded-full bg-butter px-2.5 py-0.5 text-xs font-semibold text-butter-ink">
          {t('ui.common.exampleData')}
        </span>
        <span className="flex-1" />
        <ThemeSwitch />
        <LanguageSwitch />
      </header>
      <p className="max-w-3xl text-[14px] text-ink-2">{t('ui.gallery.intro')}</p>

      <Section title={t('ui.gallery.sectionType')}>
        <Card>
          <div className="grid gap-1">
            <span className="text-[15px] font-medium text-ink-2">
              {t('ui.shell.greetingAfternoon')}
            </span>
            <DisplayName>{t('ui.gallery.displaySample')}</DisplayName>
          </div>
          <p className="max-w-2xl text-ink-2">{t('ui.gallery.bodySample')}</p>
          <div className="flex flex-wrap gap-8">
            <div>
              <span className="text-xs text-ink-2">{t('ui.gallery.moneySample')}</span>
              <p className="num text-[32px] leading-none font-extrabold tracking-tight">
                {formatMoney(locale, '182460.25', 'KWD')}
              </p>
            </div>
            <div>
              <span className="text-xs text-ink-2">{t('ui.gallery.dateSample')}</span>
              <p className="text-[18px] font-bold">
                {formatDate(locale, new Date('2026-10-24T09:00:00Z'))}
              </p>
            </div>
          </div>
        </Card>
      </Section>

      <Section title={t('ui.gallery.sectionButtons')}>
        <Card>
          <div className="flex flex-wrap items-center gap-3">
            <Button>{t('ui.gallery.primary')}</Button>
            <Button variant="secondary">{t('ui.gallery.secondary')}</Button>
            <Button variant="ghost">{t('ui.gallery.ghost')}</Button>
            <Button variant="danger">{t('ui.gallery.danger')}</Button>
            <Button disabled>{t('ui.gallery.disabled')}</Button>
            <Button loading>{t('ui.gallery.busy')}</Button>
            <Button icon={<BriefcaseBusiness aria-hidden className="size-4" />}>
              {t('ui.gallery.withIcon')}
            </Button>
            <Button size="sm" variant="secondary">
              {t('ui.gallery.secondary')}
            </Button>
            <IconButton label={t('ui.shell.notifications')} dot>
              <Bell aria-hidden />
            </IconButton>
          </div>
        </Card>
      </Section>

      <Section title={t('ui.gallery.sectionInputs')}>
        <Card>
          <div className="grid gap-4 md:grid-cols-2">
            <TextField
              label={t('ui.gallery.emailLabel')}
              type="email"
              hint={t('ui.gallery.emailHint')}
              placeholder="name@company.com"
            />
            <TextField label={t('ui.gallery.nameLabel')} error={t('ui.gallery.nameError')} />
            <SelectField
              label={t('ui.gallery.roleLabel')}
              placeholder={t('ui.gallery.rolePlaceholder')}
              options={ROLE_OPTIONS}
            />
            <TextArea label={t('ui.gallery.notesLabel')} optionalLabel={t('ui.common.optional')} />
            <Checkbox label={t('ui.gallery.rememberLabel')} />
          </div>
        </Card>
      </Section>

      <Section title={t('ui.gallery.sectionCards')}>
        <div className="flex flex-wrap gap-2.5">
          <StatCard
            label={t('ui.gallery.statClients')}
            value="48"
            delta={{ direction: 'up', text: '3' }}
          />
          <StatCard label={t('ui.gallery.statEngagements')} value="17" />
          <StatCard
            label={t('ui.gallery.statOnDuty')}
            value="39/48"
            delta={{ direction: 'down', text: '2' }}
          />
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          <Tile
            tone="lilac"
            label={t('ui.gallery.tileInvoiced')}
            value="204,880.000"
            unit={kwd}
            icon={<ReceiptText />}
          />
          <Tile
            tone="blush"
            label={t('ui.gallery.tileOutstanding')}
            value="22,419.750"
            unit={kwd}
            icon={<Hourglass />}
          />
          <Tile
            tone="mint"
            label={t('ui.gallery.tileCollected')}
            value="182,460.250"
            unit={kwd}
            icon={<Wallet />}
          />
          <Tile tone="sky" label={t('ui.gallery.tileHours')} value="1,284.5" icon={<Timer />} />
        </div>
        <Card
          title={t('ui.gallery.cardTitle')}
          action={<StatusChip status="good" label={t('ui.gallery.statusOnTrack')} />}
        >
          <p className="text-ink-2">{t('ui.gallery.cardBody')}</p>
          <div className="h-[7px] overflow-hidden rounded-full bg-frame">
            <div className="h-full w-[77%] rounded-full bg-mint-solid" />
          </div>
        </Card>
      </Section>

      <Section title={t('ui.gallery.sectionStatus')}>
        <Card>
          <div className="flex flex-wrap items-center gap-2.5">
            <StatusChip status="good" label={t('ui.gallery.statusOnTrack')} />
            <StatusChip status="warn" label={t('ui.gallery.statusNearLimit')} />
            <StatusChip status="bad" label={t('ui.gallery.statusOverBudget')} />
            <StatusChip status="info" label={t('ui.gallery.statusPlanned')} />
            <CountBadge>{t('ui.gallery.badgeCount', { count: 4 })}</CountBadge>
            <Avatar name={t('ui.gallery.personName')} initials={locale === 'ar' ? 'م خ' : 'MK'} />
            <Avatar name="Noura Al-Mutairi" initials="NM" size={32} />
            <Avatar name="Yousef Al-Kandari" initials="YK" size={32} />
          </div>
        </Card>
      </Section>

      <Section title={t('ui.gallery.sectionOverlays')}>
        <Card>
          <div className="flex flex-wrap items-center gap-3">
            <Dialog
              trigger={<Button variant="secondary">{t('ui.gallery.openDialog')}</Button>}
              title={t('ui.gallery.dialogTitle')}
              description={t('ui.gallery.dialogBody')}
              closeLabel={t('ui.common.close')}
              footer={
                <>
                  <Button variant="secondary">{t('ui.common.cancel')}</Button>
                  <Button>{t('ui.gallery.approve')}</Button>
                </>
              }
            />
            <Drawer
              trigger={<Button variant="secondary">{t('ui.gallery.openDrawer')}</Button>}
              title={t('ui.gallery.drawerTitle')}
              description={t('ui.gallery.drawerBody')}
              closeLabel={t('ui.common.close')}
            />
            <Tooltip content={t('ui.gallery.tooltipText')}>
              <Button variant="ghost">{t('ui.gallery.tooltipTrigger')}</Button>
            </Tooltip>
            <Button
              variant="secondary"
              onClick={() => {
                toast({
                  title: t('ui.gallery.toastTitle'),
                  body: t('ui.gallery.toastBody'),
                  tone: 'good',
                });
              }}
            >
              {t('ui.gallery.showToast')}
            </Button>
          </div>
        </Card>
      </Section>

      <Section title={t('ui.gallery.sectionTabs')}>
        <Card>
          <Tabs
            label={t('ui.gallery.sectionTabs')}
            items={[
              {
                value: 'overview',
                label: t('ui.gallery.tabOverview'),
                content: t('ui.gallery.tabOverviewBody'),
              },
              {
                value: 'contacts',
                label: t('ui.gallery.tabContacts'),
                content: t('ui.gallery.tabContactsBody'),
              },
              {
                value: 'documents',
                label: t('ui.gallery.tabDocuments'),
                content: t('ui.gallery.tabDocumentsBody'),
              },
            ]}
          />
        </Card>
      </Section>

      <Section title={t('ui.gallery.sectionStates')}>
        <div className="grid gap-3 md:grid-cols-4">
          <Card title={t('ui.gallery.loadingExample')}>
            <LoadingState label={t('ui.common.loading')} />
          </Card>
          <Card title={t('ui.gallery.emptyExample')}>
            <EmptyState title={t('ui.states.emptyTitle')} body={t('ui.states.emptyBody')} />
          </Card>
          <Card title={t('ui.gallery.errorExample')}>
            <ErrorState
              title={t('ui.states.errorTitle')}
              body={t('ui.states.errorBody')}
              reference={t('ui.states.errorReference', { id: '6f9395f5' })}
              retryLabel={t('ui.common.retry')}
              onRetry={() => undefined}
            />
          </Card>
          <Card title={t('ui.gallery.deniedExample')}>
            <PermissionDenied title={t('ui.states.deniedTitle')} body={t('ui.states.deniedBody')} />
          </Card>
        </div>
      </Section>

      <Section title={t('ui.gallery.sectionCharts')}>
        <div className="grid gap-3 lg:grid-cols-2">
          <Card>
            <BarChart
              title={t('ui.gallery.chartFees')}
              description={t('ui.gallery.chartFeesBody')}
              series={[
                { key: 'billed', label: t('ui.gallery.seriesBilled') },
                { key: 'collected', label: t('ui.gallery.seriesCollected') },
              ]}
              data={EXAMPLE_FEES.map((row, i) => ({
                label: formatDate(locale, new Date(2026, i, 1), { month: 'short' }),
                values: row,
              }))}
              format={(v) => formatMoney(locale, (v * 1000).toFixed(3), 'KWD')}
              formatTick={(v) => formatNumber(locale, v)}
              highlight={t('ui.dashboard.bestMonth')}
              showTableLabel={t('ui.common.showTable')}
              showChartLabel={t('ui.common.showChart')}
            />
          </Card>
          <Card>
            <LineChart
              title={t('ui.gallery.chartHours')}
              description={t('ui.gallery.chartHoursBody')}
              series={[
                { key: 'billable', label: t('ui.gallery.seriesBillable') },
                { key: 'internal', label: t('ui.gallery.seriesInternal') },
              ]}
              data={EXAMPLE_HOURS.map((row, i) => ({
                label: t('ui.gallery.week', { n: i + 1 }),
                values: row,
              }))}
              format={(v) => formatNumber(locale, v)}
              showTableLabel={t('ui.common.showTable')}
              showChartLabel={t('ui.common.showChart')}
            />
          </Card>
        </div>
      </Section>

      <Section title={t('ui.gallery.sectionShell')}>
        <div className="rounded-frame bg-ground p-4">
          <AppFrame
            sidebar={
              <Sidebar
                label={t('ui.shell.mainNavigation')}
                header={<Logo subtitle={t('ui.gallery.companyName')} />}
                profile={
                  <ProfileCard
                    avatar={
                      <Avatar
                        name={t('ui.gallery.personName')}
                        initials={locale === 'ar' ? 'م خ' : 'MK'}
                        size={48}
                      />
                    }
                    name={t('ui.gallery.personName')}
                    subtitle={t('ui.gallery.personRole')}
                  />
                }
                footer={
                  <>
                    <NavItem
                      href="#settings"
                      icon={<Settings aria-hidden />}
                      label={t('ui.shell.settings')}
                    />
                    <NavItem
                      href="#help"
                      icon={<LifeBuoy aria-hidden />}
                      label={t('ui.shell.help')}
                    />
                  </>
                }
              >
                <NavGroup title={t('ui.shell.groupMain')}>
                  <NavItem
                    href="#dashboard"
                    icon={<LayoutGrid aria-hidden />}
                    label={t('ui.shell.dashboard')}
                    current
                  />
                </NavGroup>
              </Sidebar>
            }
          >
            <Topbar
              search={<SearchBox label={t('ui.shell.search')} shortcut="Ctrl K" />}
              actions={
                <IconButton label={t('ui.shell.notifications')} dot>
                  <Bell aria-hidden />
                </IconButton>
              }
            />
            <div className="grid gap-0.5">
              <span className="text-[15px] font-medium text-ink-2">
                {t('ui.shell.greetingAfternoon')}
              </span>
              <DisplayName>{t('ui.gallery.personName')}</DisplayName>
            </div>
            <Card>
              <EmptyState title={t('ui.states.emptyTitle')} body={t('ui.states.emptyBody')} />
            </Card>
          </AppFrame>
        </div>
      </Section>
    </div>
  );
}
