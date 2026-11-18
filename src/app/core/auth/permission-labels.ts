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

  'tasks.view': 'عرض عناصر العمل',
  'tasks.create': 'إنشاء عناصر عمل جديدة',
  'tasks.edit': 'تعديل بيانات عناصر العمل',
  'tasks.assign': 'تكليف الأعضاء بعناصر العمل',
  'tasks.delete': 'أرشفة عناصر العمل',

  'statuses.manage': 'إدارة الحالات: إنشاؤها وتعديلها وتعطيلها',
  'workflows.manage': 'إدارة مسارات العمل والانتقالات المسموحة',
  'workflow.transition': 'نقل عنصر العمل بين الحالات',

  'approvals.request': 'إرسال طلبات موافقة',
  'approvals.view': 'عرض طلبات الموافقة ومسارها',
  'approvals.decide': 'اتخاذ قرار الموافقة أو الرفض أو الإعادة',
  'approvals.configure': 'إعداد قوالب الموافقات ومراحلها',

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

  'workitem.types.view': 'عرض أنواع عناصر العمل',
  'workitem.types.manage': 'إدارة أنواع عناصر العمل وقواعد التسلسل الهرمي',
  'workitem.fields.manage': 'إدارة الحقول الإضافية لأنواع العناصر',
  'project.workitemtypes.configure': 'تحديد الأنواع المسموحة والافتراضية داخل المشروع',

  'workitem.relations.view': 'عرض الروابط بين عناصر العمل',
  'workitem.relations.create': 'إنشاء روابط بين عناصر العمل',
  'workitem.relations.delete': 'حذف الروابط بين عناصر العمل',
  'workitem.relationtypes.manage': 'إدارة أنواع الروابط وأزواج الأنواع المسموحة',
};
