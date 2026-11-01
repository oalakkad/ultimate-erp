import { useMutation, useQueryClient } from '@tanstack/react-query';
import { myAttendanceSchema } from '@ultimate-erp/contracts';
import { useApi } from '../core/session';
import { isApiError } from '../lib/api';

/** Records a check-in or check-out (QR code, or web when the company allows it). */
export function useCheck() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (code: string | undefined) =>
      api('/attendance/check', {
        method: 'POST',
        body: code === undefined ? {} : { code },
        schema: myAttendanceSchema,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['attendance'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

/** The person has no employee record yet (attendance is recorded against it). */
export function noEmployeeRecord(err: unknown): boolean {
  return (
    isApiError(err, 'VALIDATION_FAILED') && err.details.some((d) => d.code === 'no_employee_record')
  );
}
