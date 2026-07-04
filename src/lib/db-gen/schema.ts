// @ts-nocheck
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */

export type Scalars = {
    Int: number,
    Boolean: boolean,
    String: string,
    JSON: any,
    ID: string,
    Float: number,
}

export interface project {
    color: (Scalars['String'] | null)
    created_at: (Scalars['String'] | null)
    id: Scalars['ID']
    name: (Scalars['String'] | null)
    updated_at: (Scalars['String'] | null)
    __typename: 'project'
}

export interface ai_memory {
    content: (Scalars['String'] | null)
    created_at: (Scalars['String'] | null)
    id: Scalars['ID']
    __typename: 'ai_memory'
}

export interface ai_thread {
    id: Scalars['ID']
    name: (Scalars['String'] | null)
    payload: (Scalars['JSON'] | null)
    updated_at: (Scalars['String'] | null)
    __typename: 'ai_thread'
}

export interface object {
    id: Scalars['ID']
    parent_id: (Scalars['String'] | null)
    payload: (Scalars['JSON'] | null)
    project_id: (Scalars['String'] | null)
    type: (Scalars['String'] | null)
    updated_at: (Scalars['String'] | null)
    x: (Scalars['Float'] | null)
    y: (Scalars['Float'] | null)
    z_index: (Scalars['Int'] | null)
    __typename: 'object'
}

export interface Mutation {
    createAi_memory: (ai_memory | null)
    createAi_thread: (ai_thread | null)
    createObject: (object | null)
    createProject: (project | null)
    deleteAi_memory: (Scalars['Boolean'] | null)
    deleteAi_thread: (Scalars['Boolean'] | null)
    deleteObject: (Scalars['Boolean'] | null)
    deleteProject: (Scalars['Boolean'] | null)
    updateAi_memory: (ai_memory | null)
    updateAi_thread: (ai_thread | null)
    updateObject: (object | null)
    updateProject: (project | null)
    __typename: 'Mutation'
}

export interface Query {
    ai_memory: (ai_memory | null)
    ai_memorys: ((ai_memory | null)[] | null)
    ai_thread: (ai_thread | null)
    ai_threads: ((ai_thread | null)[] | null)
    object: (object | null)
    objects: ((object | null)[] | null)
    project: (project | null)
    projects: ((project | null)[] | null)
    __typename: 'Query'
}

export interface ai_memoryUpdateInput {content?: (Scalars['String'] | null),created_at?: (Scalars['String'] | null)}

export interface ai_threadCreateInput {name: Scalars['String'],payload: Scalars['JSON'],updated_at: Scalars['String']}

export interface ai_threadFilterInput {updated_at?: (Scalars['String'] | null),name?: (Scalars['String'] | null)}

export interface objectFilterInput {parent_id?: (Scalars['String'] | null),z_index?: (Scalars['Int'] | null),project_id?: (Scalars['String'] | null),updated_at?: (Scalars['String'] | null),type?: (Scalars['String'] | null),x?: (Scalars['Float'] | null),y?: (Scalars['Float'] | null)}

export interface projectGenqlSelection{
    color?: boolean | number
    created_at?: boolean | number
    id?: boolean | number
    name?: boolean | number
    updated_at?: boolean | number
    __typename?: boolean | number
    __scalar?: boolean | number
}

export interface ai_memoryGenqlSelection{
    content?: boolean | number
    created_at?: boolean | number
    id?: boolean | number
    __typename?: boolean | number
    __scalar?: boolean | number
}

export interface projectUpdateInput {updated_at?: (Scalars['String'] | null),name?: (Scalars['String'] | null),color?: (Scalars['String'] | null),created_at?: (Scalars['String'] | null)}

export interface ai_threadUpdateInput {payload?: (Scalars['JSON'] | null),updated_at?: (Scalars['String'] | null),name?: (Scalars['String'] | null)}

export interface objectUpdateInput {payload?: (Scalars['JSON'] | null),updated_at?: (Scalars['String'] | null),type?: (Scalars['String'] | null),x?: (Scalars['Float'] | null),y?: (Scalars['Float'] | null),parent_id?: (Scalars['String'] | null),z_index?: (Scalars['Int'] | null),project_id?: (Scalars['String'] | null)}

export interface ai_memoryFilterInput {created_at?: (Scalars['String'] | null),content?: (Scalars['String'] | null)}

export interface ai_threadGenqlSelection{
    id?: boolean | number
    name?: boolean | number
    payload?: boolean | number
    updated_at?: boolean | number
    __typename?: boolean | number
    __scalar?: boolean | number
}

export interface projectCreateInput {created_at: Scalars['String'],updated_at: Scalars['String'],name: Scalars['String'],color?: (Scalars['String'] | null)}

export interface objectGenqlSelection{
    id?: boolean | number
    parent_id?: boolean | number
    payload?: boolean | number
    project_id?: boolean | number
    type?: boolean | number
    updated_at?: boolean | number
    x?: boolean | number
    y?: boolean | number
    z_index?: boolean | number
    __typename?: boolean | number
    __scalar?: boolean | number
}

export interface projectFilterInput {color?: (Scalars['String'] | null),created_at?: (Scalars['String'] | null),updated_at?: (Scalars['String'] | null),name?: (Scalars['String'] | null)}

export interface MutationGenqlSelection{
    createAi_memory?: (ai_memoryGenqlSelection & { __args: {id?: (Scalars['ID'] | null), input: ai_memoryCreateInput} })
    createAi_thread?: (ai_threadGenqlSelection & { __args: {input: ai_threadCreateInput, id?: (Scalars['ID'] | null)} })
    createObject?: (objectGenqlSelection & { __args: {id?: (Scalars['ID'] | null), input: objectCreateInput} })
    createProject?: (projectGenqlSelection & { __args: {id?: (Scalars['ID'] | null), input: projectCreateInput} })
    deleteAi_memory?: { __args: {id: Scalars['ID']} }
    deleteAi_thread?: { __args: {id: Scalars['ID']} }
    deleteObject?: { __args: {id: Scalars['ID']} }
    deleteProject?: { __args: {id: Scalars['ID']} }
    updateAi_memory?: (ai_memoryGenqlSelection & { __args: {id: Scalars['ID'], input: ai_memoryUpdateInput} })
    updateAi_thread?: (ai_threadGenqlSelection & { __args: {id: Scalars['ID'], input: ai_threadUpdateInput} })
    updateObject?: (objectGenqlSelection & { __args: {id: Scalars['ID'], input: objectUpdateInput} })
    updateProject?: (projectGenqlSelection & { __args: {id: Scalars['ID'], input: projectUpdateInput} })
    __typename?: boolean | number
    __scalar?: boolean | number
}

export interface objectCreateInput {project_id?: (Scalars['String'] | null),payload: Scalars['JSON'],updated_at: Scalars['String'],type: Scalars['String'],x?: (Scalars['Float'] | null),y?: (Scalars['Float'] | null),parent_id?: (Scalars['String'] | null),z_index?: (Scalars['Int'] | null)}

export interface ai_memoryCreateInput {created_at: Scalars['String'],content: Scalars['String']}

export interface QueryGenqlSelection{
    ai_memory?: (ai_memoryGenqlSelection & { __args: {id: Scalars['ID']} })
    ai_memorys?: (ai_memoryGenqlSelection & { __args?: {filter?: (ai_memoryFilterInput | null), limit?: (Scalars['Int'] | null), offset?: (Scalars['Int'] | null)} })
    ai_thread?: (ai_threadGenqlSelection & { __args: {id: Scalars['ID']} })
    ai_threads?: (ai_threadGenqlSelection & { __args?: {filter?: (ai_threadFilterInput | null), limit?: (Scalars['Int'] | null), offset?: (Scalars['Int'] | null)} })
    object?: (objectGenqlSelection & { __args: {id: Scalars['ID']} })
    objects?: (objectGenqlSelection & { __args?: {limit?: (Scalars['Int'] | null), offset?: (Scalars['Int'] | null), filter?: (objectFilterInput | null)} })
    project?: (projectGenqlSelection & { __args: {id: Scalars['ID']} })
    projects?: (projectGenqlSelection & { __args?: {offset?: (Scalars['Int'] | null), filter?: (projectFilterInput | null), limit?: (Scalars['Int'] | null)} })
    __typename?: boolean | number
    __scalar?: boolean | number
}


    const project_possibleTypes: string[] = ['project']
    export const isproject = (obj?: { __typename?: any } | null): obj is project => {
      if (!obj?.__typename) throw new Error('__typename is missing in "isproject"')
      return project_possibleTypes.includes(obj.__typename)
    }
    


    const ai_memory_possibleTypes: string[] = ['ai_memory']
    export const isai_memory = (obj?: { __typename?: any } | null): obj is ai_memory => {
      if (!obj?.__typename) throw new Error('__typename is missing in "isai_memory"')
      return ai_memory_possibleTypes.includes(obj.__typename)
    }
    


    const ai_thread_possibleTypes: string[] = ['ai_thread']
    export const isai_thread = (obj?: { __typename?: any } | null): obj is ai_thread => {
      if (!obj?.__typename) throw new Error('__typename is missing in "isai_thread"')
      return ai_thread_possibleTypes.includes(obj.__typename)
    }
    


    const object_possibleTypes: string[] = ['object']
    export const isobject = (obj?: { __typename?: any } | null): obj is object => {
      if (!obj?.__typename) throw new Error('__typename is missing in "isobject"')
      return object_possibleTypes.includes(obj.__typename)
    }
    


    const Mutation_possibleTypes: string[] = ['Mutation']
    export const isMutation = (obj?: { __typename?: any } | null): obj is Mutation => {
      if (!obj?.__typename) throw new Error('__typename is missing in "isMutation"')
      return Mutation_possibleTypes.includes(obj.__typename)
    }
    


    const Query_possibleTypes: string[] = ['Query']
    export const isQuery = (obj?: { __typename?: any } | null): obj is Query => {
      if (!obj?.__typename) throw new Error('__typename is missing in "isQuery"')
      return Query_possibleTypes.includes(obj.__typename)
    }
    