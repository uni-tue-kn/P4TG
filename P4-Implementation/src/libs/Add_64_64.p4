// https://community.intel.com/t5/Intel-Connectivity-Research/How-to-get-the-carrier-bit-of-32-bit-addition/m-p/1341493
control Add_64_64(
    out bit<64> res,
    in  bit<64> a,
    in  reg_index_t idx)
    (bit<32> reg_size)
{
// simply use 64 bit register if we are on tofino2
// does not yet work
#if __TARGET_TOFINO__ == 3
    Register<bit<64>, reg_index_t>(reg_size) reg;
    RegisterAction<bit<64>, reg_index_t, bit<64>>(reg) add = {
            void apply(inout bit<64> value, out bit<64> result) {
                value = value + a;
                result = value;
            }
     };

     apply {
        res = add.execute(idx);
     }
#else
    bit<32> a_lo_inv = ~a[31:0];
    bit<32> a_hi_with_carry;

    /* The low 32-bits of the sum */
    Register<bit<32>, reg_index_t>(reg_size) reg_lo;
    RegisterAction<bit<32>, reg_index_t, bit<32>>(reg_lo) add_lo = {
        void apply(inout bit<32> value, out bit<32> result) {
            value = value + a[31:0];
            result = value;
        }
    };

    /* Also, the low 32-bits of the sum, but the output is carry */
    Register<bit<32>, reg_index_t>(reg_size) reg_lo_carry;
    RegisterAction<bit<32>, reg_index_t, bit<32>>(reg_lo_carry) get_lo_carry = {
        void apply(inout bit<32> value, out bit<32> result) {
            if (a_lo_inv < value) {
                result = 1;
            } else {
                result = 0;
            }
            value = value + a[31:0];
        }
    };

    /* The high 32-bits of the sum */
    Register<bit<32>, reg_index_t>(reg_size) reg_hi;
    RegisterAction<bit<32>, reg_index_t, bit<32>>(reg_hi) add_hi = {
        void apply(inout bit<32> value, out bit<32> result) {
            value = value + a_hi_with_carry;
            result = value;
        }
    };

    action add_reg_lo() {
        res[31:0]  = add_lo.execute(idx);
    }

    action get_carry() {
        a_hi_with_carry = a[63:32] + get_lo_carry.execute(idx);
    }

    action add_reg_hi() {
        res[63:32] = add_hi.execute(idx);
    }

    apply {
        /* Stage N (this might also include computing a_lo_inv)*/
        add_reg_lo();

        /* Stage N+1 (for now) */
        get_carry();

        /* Stage N+2 (for now) */
        add_reg_hi();
    }
#endif
}
