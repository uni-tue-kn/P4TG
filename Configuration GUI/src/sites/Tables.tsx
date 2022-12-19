import React, {useEffect, useState} from 'react'
import {get} from "../common/API";
import Loader from "../components/Loader";
import {Button, Tab, Table, Tabs} from "react-bootstrap";


interface TableViewProps {
    name: string
    data: { data: Object, key: Object }[]
}

const sort_json = (json: any) => {
    return Object.keys(json).sort().reduce(
        (obj: any, key) => {
            obj[key] = json[key];
            return obj;
        },
        {}
    );
}


const TableView = ({name, data}: TableViewProps) => {
    return <>
        <Table striped bordered hover size="sm" className={"mt-3 mb-3"}>
            <thead className={"table-dark"}>
            <tr>
                <th>#</th>
                <th>Key</th>
                <th>Action</th>
            </tr>
            </thead>
            <tbody>
            {data.map((v: { key: any, data: any }, i) => {
                return <tr key={i}>
                    <td>{i + 1}</td>
                    <td>
                        <Table bordered hover size={"sm"} responsive={true}>
                            <thead>
                            <tr>
                                {Object.keys(v.key).map((k, i) => {
                                    return <th key={i}>{k}</th>
                                })}
                            </tr>
                            </thead>
                            <tbody>
                            <tr>
                                {Object.keys(v.key).map((k, i) => {
                                    return <td key={i}>{v.key[k].value}</td>
                                })}
                            </tr>
                            </tbody>
                        </Table>
                    </td>
                    <td>
                        <Table bordered hover size={"sm"} responsive={true}>
                            <thead>
                            <tr>
                                {Object.keys(v.data).map((k, i) => {
                                    return <td key={i}>{k}</td>
                                })}
                            </tr>
                            </thead>
                            <tbody>
                            <tr>
                                {Object.keys(v.data).map((k, i) => {
                                    return <td key={i}>{v.data[k]}</td>
                                })}
                            </tr>
                            </tbody>
                        </Table>
                    </td>
                </tr>
            })
            }
            </tbody>
        </Table>
    </>

}

const Tables = () => {
    const [loaded, set_loaded] = useState(false)
    const [table_data, set_table_data] = useState<{[name: string]: object}>({})

    const loadTables = async () => {
        let tables = await get({route: "/tables"})

        if (tables.status === 200) {
            set_table_data(sort_json(tables.data))
        }
    }

    const refresh = async () => {
        set_loaded(false)
        await loadTables()
        set_loaded(true)
    }

    useEffect(() => {
        refresh()

    }, [])

    return <Loader loaded={loaded}>
        <Tabs
            defaultActiveKey="0"
            className="mt-3"
        >
        {Object.keys(table_data).map((e: string, i: number) => {
            // @ts-ignore
            return <Tab eventKey={i} key={i} title={e}><TableView key={i} name={e} data={table_data[e]}/>
            </Tab>
        })
        }
        </Tabs>
        <Button onClick={refresh} className={"mt-3"}><i className="bi bi-arrow-clockwise"/> Refresh</Button>
    </Loader>
}

export default Tables;