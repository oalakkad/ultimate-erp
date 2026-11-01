import { type NavigatorScreenParams } from '@react-navigation/native';

/** Every screen and its parameters (typed navigation). */
export type TabsParamList = {
  Home: undefined;
  Attendance: undefined;
  Tasks: undefined;
  Time: undefined;
  Leave: undefined;
};

export type RootParamList = {
  SignIn: undefined;
  TwoFactor: undefined;
  Companies: undefined;
  Main: NavigatorScreenParams<TabsParamList> | undefined;
  TaskDetail: { id: string };
  LeaveApply: undefined;
  Scan: undefined;
  Correction: undefined;
  Notifications: undefined;
  Account: undefined;
};
