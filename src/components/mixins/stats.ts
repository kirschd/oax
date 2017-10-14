import flatten from 'lodash-es/flatten'
import groupBy from 'lodash-es/groupBy'
import map from 'lodash-es/map'
import maxBy from 'lodash-es/maxBy'
import orderBy from 'lodash-es/orderBy'
import round from 'lodash-es/round'
import sum from 'lodash-es/sum'
import sumBy from 'lodash-es/sumBy'
import values from 'lodash-es/values'

import {histogram, extent, Bin} from 'd3-array'
import {scaleLinear} from 'd3-scale'

import {groupings} from './stats/groupings'
import {IRecord} from './stats/IRecord';
import {IGrouping} from './stats/IGrouping';
import {IGrouped} from './stats/IGrouped';
import {ICounted} from "./stats/ICounted";
import {IHistogram} from "./stats/IHistogram";

const DECS = 'desc'
const ASC = 'asc'
const TITLE = 'title'
const OTHER = 'other'
const TOTAL = 'total'

export default {
  data(): { data?: IRecord, selectionData?: any[], pickTop: number, groupings: IGrouping[], grouping: IGrouping, counting: IGrouping } {
    return {
      data: null,
      selectionData: null,
      pickTop: 10,
      groupings,
      grouping: groupings[1],
      counting: groupings[2]
    }
  },
  computed: {
    grouped(): IGrouped[] {
      if (!this.data) {
        return null
      }

      const data = !this.grouping.expand ? this.data : flatten(this.data.map(this.grouping.expand))
      const records = map(groupBy(data, this.grouping.select), (records, title) => ({
        title,
        records,
        prop: this.propName(title)
      }))
      return orderBy(records, [(d) => d.records.length, TITLE], [DECS, ASC])
    },
    top(): IGrouped[] {
      if (!this.grouped) {
        return null
      }

      let top

      if (this.grouped.length <= this.pickTop) {
        top = this.grouped
      } else {
        const pick = Math.max(0, Math.min(this.grouped.length - 1, this.pickTop - 1))
        const min = this.grouped[pick].records.length
        top = (this.grouped as IGrouped[]).filter(d => d.records.length > min)

        const records = [].concat.apply([], (this.grouped as IGrouped[]).filter(d => d.records.length <= min).map(d => d.records))
        top.push({title: OTHER, records, prop: this.propName(OTHER), min})
      }

      top.forEach(this.aggregate)

      return orderBy(top, [TOTAL, TITLE], [DECS, ASC])
    },
    total(): number {
      return !this.data ? null : this.data.length
    },
    selection: {
      get(): IGrouped[] {
        return this.selectionData ? this.selectionData : []
      },
      set(value: IGrouped[]) {
        this.selectionData = value
      }
    },
    selected(): IGrouped[] {
      return this.top ? this.selection.length ? this.selection : this.top : null
    },
    filtered() {
      return this.selected ? [].concat.apply([], (this.selected as IGrouped[]).map(d => {
        d.records.forEach(r => {
          r.column = d.title
        })
        return d.records
      })) : null
    },
    counted(): ICounted[] {
      if (!this.filtered) {
        return null
      }

      const data = !this.counting.expand ? this.filtered : flatten(this.filtered.map(this.counting.expand))

      const records: ICounted[] = map(groupBy(data, this.counting.select),
        (records, title) => ({
          title: this.counting.number ? parseInt(title) : title,
          prop: this.propName(title),
          records,
          total: records.length,
          value: this.counting.number ? parseInt(title) : undefined
        })) as ICounted[];

      (this.selected as IGrouped[]).forEach(s => {
        records.forEach(record => {
          record[this.propName(s.title)] = record.records.filter(d => d.column === s.title).length
        })
      })

      return orderBy(records, [TOTAL, TITLE], [DECS, ASC])
    },
    histogram() {
      if (!this.counting.number) {
        return null
      }

      const e: number[] = extent<number>(this.counted, d => (d as any).value) as number[]
      const w = 320
      const x = scaleLinear()
        .domain(e)
        .rangeRound([0, w])

      const h: Array<Bin<ICounted, number>> = histogram<ICounted, number>()
        .value(d => (d as any).value)
        .domain(x.domain() as [number, number])
        .thresholds(x.ticks(Math.min(e[1] - e[0], 32)))(this.counted);

      (h as IHistogram[]).forEach(c => {
        c.x = x(c.x0)
        c.width = x(c.x1 - c.x0)

        for (let i = 0; i < c.length; i++) {
          if (c[i]) {
            (this.selected as IGrouped[]).forEach(s => {
              c.histSum = c.histSum || {}
              c.histSum[s.title] = c.histSum[s.title] || 0;
              (c.histSum[s.title] as any) += c[i][this.propName(s.title)] > 0 ? c[i][this.propName(s.title)] : 0
            })
          }
        }

        let prev = 0;

        (this.selected as IGrouped[]).forEach(s => {
          c.histPos = c.histPos || {}
          c.histPos[s.title] = prev
          prev += (c.histSum && (c.histSum[s.title] > 0)) ? c.histSum[s.title] : 0
        })

        c.histMax = prev
      })

      const m: number = (maxBy((h as IHistogram[]), 'histMax') || {histMax: 1}).histMax;

      (h as IHistogram[]).forEach(c => {
        (this.selected as IGrouped[]).forEach(s => {
          if (c.histPos && c.histPos[s.title]) {
            c.histPos[s.title] /= m
            c.histPos[s.title] *= 320

            c.histSum[s.title] /= m
            c.histSum[s.title] *= 320
          }
        })
      })

      return h
    }
  },
  methods: {
    aggregate(t: IGrouped) {
      t.total = t.records.length

      t.pathsTotal = sumBy(t.records, 'paths')
      t.paths = round(t.pathsTotal / t.total, 1)

      t.tagsTotal = sumBy(t.records, 'tags')
      t.tags = round(t.tagsTotal / t.total, 1)

      t.definitionsTotal = sumBy(t.records, 'definitions')
      t.definitions = round(t.definitionsTotal / t.total, 1)

      t.methodsTotal = sumBy(t.records, u => sum(values(u.methods)))
      t.methods = round(t.methodsTotal / t.total, 1)

      t.summariesTotal = sumBy(t.records, 'summaries')
      t.summaries = t.summariesTotal / t.total

      t.descriptionsTotal = sumBy(t.records, 'descriptions')
      t.descriptions = t.descriptionsTotal / t.total

      t.descriptionLengthsTotal = sumBy(t.records, 'descriptionsLength')
      t.descriptionLengths = t.descriptionLengthsTotal / t.descriptionsTotal

      t.summaryLengthsTotal = sumBy(t.records, 'summariesLength')
      t.summaryLengths = t.summaryLengthsTotal / t.summariesTotal
    },
    propName(t: string): string {
      return '$' + t.replace(/\./g, '_')
    }
  },
  watch: {
    grouping: function () {
      this.selectionData = null
    },
    pickTop: function () {
      this.selectionData = null
    }
  }
}
