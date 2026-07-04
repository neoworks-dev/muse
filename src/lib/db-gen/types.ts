export default {
    "scalars": [
        2,
        6,
        10,
        18,
        22,
        23
    ],
    "types": {
        "ai_memoryUpdateInput": {
            "content": [
                10
            ],
            "created_at": [
                10
            ],
            "__typename": [
                10
            ]
        },
        "ai_threadCreateInput": {
            "name": [
                10
            ],
            "payload": [
                18
            ],
            "updated_at": [
                10
            ],
            "__typename": [
                10
            ]
        },
        "Int": {},
        "ai_threadFilterInput": {
            "updated_at": [
                10
            ],
            "name": [
                10
            ],
            "__typename": [
                10
            ]
        },
        "objectFilterInput": {
            "parent_id": [
                10
            ],
            "z_index": [
                2
            ],
            "project_id": [
                10
            ],
            "updated_at": [
                10
            ],
            "type": [
                10
            ],
            "x": [
                23
            ],
            "y": [
                23
            ],
            "__typename": [
                10
            ]
        },
        "project": {
            "color": [
                10
            ],
            "created_at": [
                10
            ],
            "id": [
                22
            ],
            "name": [
                10
            ],
            "updated_at": [
                10
            ],
            "__typename": [
                10
            ]
        },
        "Boolean": {},
        "ai_memory": {
            "content": [
                10
            ],
            "created_at": [
                10
            ],
            "id": [
                22
            ],
            "__typename": [
                10
            ]
        },
        "projectUpdateInput": {
            "updated_at": [
                10
            ],
            "name": [
                10
            ],
            "color": [
                10
            ],
            "created_at": [
                10
            ],
            "__typename": [
                10
            ]
        },
        "ai_threadUpdateInput": {
            "payload": [
                18
            ],
            "updated_at": [
                10
            ],
            "name": [
                10
            ],
            "__typename": [
                10
            ]
        },
        "String": {},
        "objectUpdateInput": {
            "payload": [
                18
            ],
            "updated_at": [
                10
            ],
            "type": [
                10
            ],
            "x": [
                23
            ],
            "y": [
                23
            ],
            "parent_id": [
                10
            ],
            "z_index": [
                2
            ],
            "project_id": [
                10
            ],
            "__typename": [
                10
            ]
        },
        "ai_memoryFilterInput": {
            "created_at": [
                10
            ],
            "content": [
                10
            ],
            "__typename": [
                10
            ]
        },
        "ai_thread": {
            "id": [
                22
            ],
            "name": [
                10
            ],
            "payload": [
                18
            ],
            "updated_at": [
                10
            ],
            "__typename": [
                10
            ]
        },
        "projectCreateInput": {
            "created_at": [
                10
            ],
            "updated_at": [
                10
            ],
            "name": [
                10
            ],
            "color": [
                10
            ],
            "__typename": [
                10
            ]
        },
        "object": {
            "id": [
                22
            ],
            "parent_id": [
                10
            ],
            "payload": [
                18
            ],
            "project_id": [
                10
            ],
            "type": [
                10
            ],
            "updated_at": [
                10
            ],
            "x": [
                23
            ],
            "y": [
                23
            ],
            "z_index": [
                2
            ],
            "__typename": [
                10
            ]
        },
        "projectFilterInput": {
            "color": [
                10
            ],
            "created_at": [
                10
            ],
            "updated_at": [
                10
            ],
            "name": [
                10
            ],
            "__typename": [
                10
            ]
        },
        "Mutation": {
            "createAi_memory": [
                7,
                {
                    "id": [
                        22
                    ],
                    "input": [
                        20,
                        "ai_memoryCreateInput!"
                    ]
                }
            ],
            "createAi_thread": [
                13,
                {
                    "input": [
                        1,
                        "ai_threadCreateInput!"
                    ],
                    "id": [
                        22
                    ]
                }
            ],
            "createObject": [
                15,
                {
                    "id": [
                        22
                    ],
                    "input": [
                        19,
                        "objectCreateInput!"
                    ]
                }
            ],
            "createProject": [
                5,
                {
                    "id": [
                        22
                    ],
                    "input": [
                        14,
                        "projectCreateInput!"
                    ]
                }
            ],
            "deleteAi_memory": [
                6,
                {
                    "id": [
                        22,
                        "ID!"
                    ]
                }
            ],
            "deleteAi_thread": [
                6,
                {
                    "id": [
                        22,
                        "ID!"
                    ]
                }
            ],
            "deleteObject": [
                6,
                {
                    "id": [
                        22,
                        "ID!"
                    ]
                }
            ],
            "deleteProject": [
                6,
                {
                    "id": [
                        22,
                        "ID!"
                    ]
                }
            ],
            "updateAi_memory": [
                7,
                {
                    "id": [
                        22,
                        "ID!"
                    ],
                    "input": [
                        0,
                        "ai_memoryUpdateInput!"
                    ]
                }
            ],
            "updateAi_thread": [
                13,
                {
                    "id": [
                        22,
                        "ID!"
                    ],
                    "input": [
                        9,
                        "ai_threadUpdateInput!"
                    ]
                }
            ],
            "updateObject": [
                15,
                {
                    "id": [
                        22,
                        "ID!"
                    ],
                    "input": [
                        11,
                        "objectUpdateInput!"
                    ]
                }
            ],
            "updateProject": [
                5,
                {
                    "id": [
                        22,
                        "ID!"
                    ],
                    "input": [
                        8,
                        "projectUpdateInput!"
                    ]
                }
            ],
            "__typename": [
                10
            ]
        },
        "JSON": {},
        "objectCreateInput": {
            "project_id": [
                10
            ],
            "payload": [
                18
            ],
            "updated_at": [
                10
            ],
            "type": [
                10
            ],
            "x": [
                23
            ],
            "y": [
                23
            ],
            "parent_id": [
                10
            ],
            "z_index": [
                2
            ],
            "__typename": [
                10
            ]
        },
        "ai_memoryCreateInput": {
            "created_at": [
                10
            ],
            "content": [
                10
            ],
            "__typename": [
                10
            ]
        },
        "Query": {
            "ai_memory": [
                7,
                {
                    "id": [
                        22,
                        "ID!"
                    ]
                }
            ],
            "ai_memorys": [
                7,
                {
                    "filter": [
                        12
                    ],
                    "limit": [
                        2
                    ],
                    "offset": [
                        2
                    ]
                }
            ],
            "ai_thread": [
                13,
                {
                    "id": [
                        22,
                        "ID!"
                    ]
                }
            ],
            "ai_threads": [
                13,
                {
                    "filter": [
                        3
                    ],
                    "limit": [
                        2
                    ],
                    "offset": [
                        2
                    ]
                }
            ],
            "object": [
                15,
                {
                    "id": [
                        22,
                        "ID!"
                    ]
                }
            ],
            "objects": [
                15,
                {
                    "limit": [
                        2
                    ],
                    "offset": [
                        2
                    ],
                    "filter": [
                        4
                    ]
                }
            ],
            "project": [
                5,
                {
                    "id": [
                        22,
                        "ID!"
                    ]
                }
            ],
            "projects": [
                5,
                {
                    "offset": [
                        2
                    ],
                    "filter": [
                        16
                    ],
                    "limit": [
                        2
                    ]
                }
            ],
            "__typename": [
                10
            ]
        },
        "ID": {},
        "Float": {}
    }
}