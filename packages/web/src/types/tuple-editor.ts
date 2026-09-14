export type TupleVariableNodeKind = 'iri' | 'literal';

export type TupleVariableField =
  | 'name'
  | 'nodeKind'
  | 'datatype'
  | 'customDatatype';

export interface TupleVariableDefinition {
  id?: string;
  memberId?: string;
  name: string;
  nodeKind: TupleVariableNodeKind;
  datatype: string;
  customDatatype?: string;
}

export interface TupleDefinition {
  id?: string;
  label?: string | null;
  variables: TupleVariableDefinition[];
}

export interface TupleEditorUpdatePayload {
  tupleIndex: number;
  variableIndex: number;
  field: TupleVariableField;
  value: string;
}
