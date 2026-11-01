import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { DarkTheme, DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { CalendarDays, Clock, House, ListChecks, QrCode } from 'lucide-react-native';
import { AccountScreen } from '../screens/account';
import { AttendanceScreen } from '../screens/attendance';
import { CompaniesScreen } from '../screens/companies';
import { CorrectionScreen } from '../screens/correction';
import { HomeScreen } from '../screens/home';
import { LeaveScreen } from '../screens/leave';
import { LeaveApplyScreen } from '../screens/leave-apply';
import { NotificationsScreen } from '../screens/notifications';
import { ScanScreen } from '../screens/scan';
import { SignInScreen } from '../screens/sign-in';
import { TaskDetailScreen } from '../screens/task-detail';
import { TasksScreen } from '../screens/tasks';
import { TimeScreen } from '../screens/time';
import { TwoFactorScreen } from '../screens/two-factor';
import { Loading } from '../ui/states';
import { useTheme } from '../ui/theme';
import { useI18n } from './i18n';
import { type RootParamList, type TabsParamList } from './routes';
import { useSession } from './session';

const Stack = createNativeStackNavigator<RootParamList>();
const Tabs = createBottomTabNavigator<TabsParamList>();

function MainTabs() {
  const { t } = useI18n();
  const theme = useTheme();
  return (
    <Tabs.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.plum,
        tabBarInactiveTintColor: theme.ink3,
        tabBarStyle: { backgroundColor: theme.card, borderTopColor: theme.line },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="Home"
        component={HomeScreen}
        options={{
          title: t('ui.mobile.home'),
          tabBarIcon: ({ color, size }) => <House color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="Attendance"
        component={AttendanceScreen}
        options={{
          title: t('ui.shell.attendance'),
          tabBarIcon: ({ color, size }) => <QrCode color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="Tasks"
        component={TasksScreen}
        options={{
          title: t('ui.shell.tasks'),
          tabBarIcon: ({ color, size }) => <ListChecks color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="Time"
        component={TimeScreen}
        options={{
          title: t('ui.shell.time'),
          tabBarIcon: ({ color, size }) => <Clock color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="Leave"
        component={LeaveScreen}
        options={{
          title: t('ui.shell.leave'),
          tabBarIcon: ({ color, size }) => <CalendarDays color={color} size={size} />,
        }}
      />
    </Tabs.Navigator>
  );
}

/**
 * The screens that exist depend on the session: signed out → sign-in (and two-factor); signed in
 * without a company → companies; in a company → the tabs and the detail screens.
 */
export function Navigation() {
  const { t } = useI18n();
  const theme = useTheme();
  const { status } = useSession();
  if (status === 'loading') return <Loading />;
  const navTheme = theme.dark ? DarkTheme : DefaultTheme;
  const headerOptions = {
    headerStyle: { backgroundColor: theme.frame },
    headerTintColor: theme.ink,
    headerShadowVisible: false,
    headerTitleStyle: { fontWeight: '700' as const },
    contentStyle: { backgroundColor: theme.frame },
  };
  return (
    <NavigationContainer
      theme={{
        ...navTheme,
        colors: {
          ...navTheme.colors,
          background: theme.frame,
          primary: theme.plum,
          card: theme.card,
          text: theme.ink,
          border: theme.line,
        },
      }}
    >
      <Stack.Navigator screenOptions={headerOptions}>
        {status === 'signed_out' || status === 'two_factor' ? (
          <>
            <Stack.Screen name="SignIn" component={SignInScreen} options={{ headerShown: false }} />
            <Stack.Screen
              name="TwoFactor"
              component={TwoFactorScreen}
              options={{ title: t('ui.auth.twoFactorTitle') }}
            />
          </>
        ) : status === 'choose_company' ? (
          <Stack.Screen
            name="Companies"
            component={CompaniesScreen}
            options={{ headerShown: false }}
          />
        ) : (
          <>
            <Stack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
            <Stack.Screen
              name="TaskDetail"
              component={TaskDetailScreen}
              options={{ title: t('ui.shell.tasks') }}
            />
            <Stack.Screen
              name="LeaveApply"
              component={LeaveApplyScreen}
              options={{ title: t('ui.leave.apply') }}
            />
            <Stack.Screen
              name="Scan"
              component={ScanScreen}
              options={{ title: t('ui.attendance.scanTitle') }}
            />
            <Stack.Screen
              name="Correction"
              component={CorrectionScreen}
              options={{ title: t('ui.attendance.askCorrection') }}
            />
            <Stack.Screen
              name="Notifications"
              component={NotificationsScreen}
              options={{ title: t('ui.notifications.title') }}
            />
            <Stack.Screen
              name="Account"
              component={AccountScreen}
              options={{ title: t('ui.shell.myAccount') }}
            />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
