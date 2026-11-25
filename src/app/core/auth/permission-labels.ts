import { PermissionKey } from './permissions';

/**
 * Concise Arabic description of every permission key (SRS §2.3), for role editors and rule dialogs.
 * Typed as an exhaustive `Record`, so adding a key to `permissions.ts` fails the build until it is described here.
 */
export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  'projects.view': 'عرض المشاريع التي أنت عضو فيها',
  'projects.create': 'إنشاء مشاريع جديدة',
  'projects.edit': 'تعديل بيانات المشروع وإعداداته',
  'projects.archive': 'أرشفة المشروع واستعادته',
  'projects.members.manage': 'إضافة أعضاء المشروع وتغيير أدوارهم وإزالتهم',

  'tasks.view': 'عرض الأعمال',
  'tasks.create': 'إنشاء أعمال جديدة',
  'tasks.edit': 'تعديل بيانات الأعمال',
  'tasks.assign': 'تكليف الأعضاء بالأعمال',
  'tasks.delete': 'أرشفة الأعمال',

  'statuses.manage': 'إدارة الحالات: إنشاؤها وتعديلها وتعطيلها',
  'workflows.manage': 'إدارة مسارات العمل والانتقالات المسموحة',
  'workflow.transition': 'نقل العمل بين الحالات',

  'approvals.request': 'إرسال طلبات موافقة',
  'approvals.view': 'عرض طلبات الموافقة ومسارها',
  'approvals.decide': 'اتخاذ قرار الموافقة أو الرفض أو الإعادة',
  'approvals.configure': 'إعداد قوالب الموافقات ومراحلها',
  'approvals.override': 'قرار نهائي يتخطى مراحل الموافقة (حتى على طلبك)',

  'comments.create': 'إضافة تعليقات',
  'comments.edit_own': 'تعديل تعليقاتك خلال المهلة المحددة',
  'files.upload': 'رفع المرفقات',
  'files.download': 'تنزيل المرفقات',
  'files.delete': 'حذف المرفقات',

  'git.view': 'عرض مستودعات Git وأحداثها',
  'git.manage': 'ربط المستودعات وإدارة الويب هوك',
  'git.sync': 'مزامنة أحداث Git وإعادة إرسالها',

  'roles.manage': 'إدارة المستخدمين والأدوار',
  'permissions.assign': 'منح الصلاحيات للأدوار وتعيين الأدوار للمستخدمين',
  'audit.view': 'عرض سجل التدقيق الكامل، بما فيه الأحداث الأمنية',
  'audit.export': 'تصدير سجل التدقيق',
  'audit.override': 'تجاوز القيود المحمية، وكل استخدام له يُسجَّل',
  'settings.manage': 'إدارة إعدادات النظام وقوالب المشاريع',

  'dashboard.view': 'عرض لوحة القيادة',
  'reports.view': 'عرض التقارير والخط الزمني',
  'reports.export': 'تصدير التقارير',

  'workitem.types.view': 'عرض أنواع الأعمال',
  'workitem.types.manage': 'إدارة أنواع الأعمال وقواعد التسلسل الهرمي',
  'workitem.fields.manage': 'إدارة الحقول الإضافية لأنواع الأعمال',
  'project.workitemtypes.configure': 'تحديد الأنواع المسموحة والافتراضية داخل المشروع',

  'workitem.relations.view': 'عرض الروابط بين الأعمال',
  'workitem.relations.create': 'إنشاء روابط بين الأعمال',
  'workitem.relations.delete': 'حذف الروابط بين الأعمال',
  'workitem.relationtypes.manage': 'إدارة أنواع الروابط وأزواج الأنواع المسموحة',
};
