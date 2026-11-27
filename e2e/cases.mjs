export const CASES = [
  { parameterType: 'ChoiceParameter', widget: 'PT_SINGLE_SELECT', values: ['choice-b'] },
  { parameterType: 'ChoiceParameter', widget: 'PT_MULTI_SELECT', values: ['choice-a', 'choice-b'] },
  { parameterType: 'ChoiceParameter', widget: 'PT_RADIO', values: ['choice-b'] },
  { parameterType: 'ChoiceParameter', widget: 'PT_CHECKBOX', values: ['choice-a', 'choice-b'] },
  { parameterType: 'CascadeChoiceParameter', widget: 'PT_SINGLE_SELECT', values: ['south-b'] },
  { parameterType: 'CascadeChoiceParameter', widget: 'PT_MULTI_SELECT', values: ['south-a', 'south-b'] },
  { parameterType: 'CascadeChoiceParameter', widget: 'PT_RADIO', values: ['south-b'] },
  { parameterType: 'CascadeChoiceParameter', widget: 'PT_CHECKBOX', values: ['south-a', 'south-b'] },
  { parameterType: 'DynamicReferenceParameter', widget: 'ET_TEXT_BOX' },
  { parameterType: 'DynamicReferenceParameter', widget: 'ET_ORDERED_LIST' },
  { parameterType: 'DynamicReferenceParameter', widget: 'ET_UNORDERED_LIST' },
  { parameterType: 'DynamicReferenceParameter', widget: 'ET_FORMATTED_HTML' },
  { parameterType: 'DynamicReferenceParameter', widget: 'ET_FORMATTED_HIDDEN_HTML' },
];

export function standardScript(type, widget) {
  if (type !== 'CascadeChoiceParameter') {
    return "return ['choice-a', 'choice-b', 'choice-c']";
  }
  const selected = widget === 'PT_MULTI_SELECT' || widget === 'PT_CHECKBOX'
    ? "['south-a:selected', 'south-b:selected']"
    : "['south-a:selected', 'south-b']";
  return `return PARENT == 'south' ? ${selected} : ['north-a', 'north-b']`;
}

export function referenceScript(widget) {
  if (widget === 'ET_TEXT_BOX') {
    return "return 'reference-display-' + PARENT";
  }
  if (widget === 'ET_ORDERED_LIST' || widget === 'ET_UNORDERED_LIST') {
    return "return ['reference-' + PARENT + '-one', 'reference-' + PARENT + '-two']";
  }
  return "return '<span>html-' + PARENT + '</span>' + " +
    "'<input type=\"hidden\" name=\"value\" value=\"html-value-' + PARENT + '\">'";
}

export function expectedApiReference(widget) {
  if (widget === 'ET_ORDERED_LIST' || widget === 'ET_UNORDERED_LIST') {
    return 'reference-south-one';
  }
  return '';
}

export function expectedCascadeDefault(widget) {
  return widget === 'PT_MULTI_SELECT' || widget === 'PT_CHECKBOX'
    ? 'south-a,south-b'
    : 'south-a';
}
