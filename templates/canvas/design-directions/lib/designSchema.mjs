// lib/designSchema.mjs — the shape every design-directions spec.json must obey, and a hand-rolled
// structural validator (no dependency — this skill has none; see lib/validate.mjs for the CLI).

export const DESIGN_SPEC_SCHEMA = {
  type: 'object',
  properties: {
    concept: {
      type: 'object',
      properties: {
        overview: { type: 'string', description: 'What this screen is and does, in plain terms.' },
        rationale: {
          type: 'string',
          description: 'Why this structure, grounded in the design system and product rules given.',
        },
      },
      required: ['overview', 'rationale'],
    },
    layout: {
      type: 'object',
      properties: {
        structure: {
          type: 'string',
          description: 'The screen broken into its regions, top to bottom.',
        },
        hierarchy: { type: 'string', description: 'What reads first, second, third, and why.' },
        whatIsAboveTheFold: { type: 'string' },
      },
      required: ['structure', 'hierarchy', 'whatIsAboveTheFold'],
    },
    components: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          variants: { type: 'array', items: { type: 'string' } },
          tokens: {
            type: 'array',
            items: { type: 'string' },
            description:
              "Which of YOUR design system's tokens this component uses, by name — e.g. this " +
              "project's own spacing/colour/radius token names, not raw values.",
          },
        },
        required: ['name', 'description', 'variants', 'tokens'],
      },
    },
    colourUsage: {
      type: 'object',
      properties: {
        primary: { type: 'array', items: { type: 'string' } },
        accents: { type: 'array', items: { type: 'string' } },
        grounds: { type: 'array', items: { type: 'string' } },
        rationale: { type: 'string' },
      },
      required: ['primary', 'accents', 'grounds', 'rationale'],
    },
    interactions: {
      type: 'object',
      properties: {
        taps: { type: 'array', items: { type: 'string' } },
        transitions: { type: 'array', items: { type: 'string' } },
        haptics: {
          type: 'array',
          items: { type: 'string' },
          description: 'Names from your own design system\'s haptics table, if it has one.',
        },
      },
      required: ['taps', 'transitions', 'haptics'],
    },
    implementation: {
      type: 'object',
      properties: {
        sketch: {
          type: 'string',
          description:
            'A conceptual composition using ONLY components named in <YOUR_COMPONENT_MANIFEST_DOC>.',
        },
        hierarchy: { type: 'string', description: 'The component tree, nesting made explicit.' },
        propsInterface: {
          type: 'string',
          description: 'The screen-level props shape, as a TS-ish sketch.',
        },
      },
      required: ['sketch', 'hierarchy', 'propsInterface'],
    },
    copy: {
      type: 'array',
      description: 'Every string that appears on the screen, verbatim, obeying your voice rules.',
      items: {
        type: 'object',
        properties: {
          element: {
            type: 'string',
            description: 'Which part of the screen this string belongs to.',
          },
          text: { type: 'string', description: 'The exact copy, verbatim.' },
        },
        required: ['element', 'text'],
      },
    },
  },
  required: [
    'concept',
    'layout',
    'components',
    'colourUsage',
    'interactions',
    'implementation',
    'copy',
  ],
};

function typeOf(v) {
  if (Array.isArray(v)) return 'array';
  if (v === null) return 'null';
  return typeof v;
}

function validateAgainst(value, schema, path, errors) {
  if (schema.type === 'object') {
    if (typeOf(value) !== 'object') {
      errors.push(`${path}: expected object, got ${typeOf(value)}`);
      return;
    }
    for (const key of schema.required ?? []) {
      if (!(key in value)) errors.push(`${path}.${key}: missing required field`);
    }
    for (const [key, subSchema] of Object.entries(schema.properties ?? {})) {
      if (key in value) validateAgainst(value[key], subSchema, `${path}.${key}`, errors);
    }
  } else if (schema.type === 'array') {
    if (typeOf(value) !== 'array') {
      errors.push(`${path}: expected array, got ${typeOf(value)}`);
      return;
    }
    if (schema.items) {
      value.forEach((item, i) => validateAgainst(item, schema.items, `${path}[${i}]`, errors));
    }
  } else if (schema.type === 'string') {
    if (typeOf(value) !== 'string') errors.push(`${path}: expected string, got ${typeOf(value)}`);
  }
}

/** Structural check against DESIGN_SPEC_SCHEMA. Returns { valid, errors }. */
export function validateDesignSpec(spec) {
  const errors = [];
  validateAgainst(spec, DESIGN_SPEC_SCHEMA, '$', errors);
  return { valid: errors.length === 0, errors };
}
